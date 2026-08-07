/**
 * Transactional email message shaping and recipient guards.
 *
 * This module is pure — it validates and normalises a message, and decides who
 * is allowed to receive it. Nothing here talks to a network. `send.ts` holds
 * the transports.
 *
 * Scope matters here: these are *platform* emails (admin invites, notification
 * digests, account mail). Client outreach does not come through this module at
 * all — PRD §12.1 sends that from each CAM's own authorised Gmail account via
 * `users.messages.send`, so the reply threading and message identifiers stay
 * attached to a real mailbox. Do not route outreach through here.
 */

import { z } from "zod";

import { emailField } from "../validation.ts";

/** Longest subject we will send. Anything longer is a bug, not a long subject. */
const MAX_SUBJECT_LENGTH = 200;

/** Longest body we will send, in characters. Well above any template we have. */
const MAX_BODY_LENGTH = 100_000;

/** A message as an application feature hands it to us. */
export type EmailMessage = {
  /** One address, or several. Duplicates and casing are cleaned up. */
  to: string | readonly string[];
  subject: string;
  /** Plain-text body. Required — every email must be readable without HTML. */
  text: string;
  /** Optional HTML body, sent alongside `text` as the richer alternative. */
  html?: string;
  /** Where replies should go, if not the `from` address. */
  replyTo?: string;
};

/** A message that has passed validation and is ready for a transport. */
export type NormalisedMessage = {
  to: readonly string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

const messageSchema = z.object({
  to: z
    .union([emailField(), z.array(emailField()).min(1)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    // Two features asking for the same recipient must not produce two emails.
    .transform((value) => [...new Set(value)]),
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required.")
    .max(MAX_SUBJECT_LENGTH, `Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer.`)
    // A newline in a subject is how header injection starts. Collapse, never send.
    .transform((value) => value.replace(/\s+/g, " ")),
  text: z
    .string()
    .min(1, "A plain-text body is required.")
    .max(MAX_BODY_LENGTH, "Body is too long to send."),
  html: z.string().max(MAX_BODY_LENGTH, "Body is too long to send.").optional(),
  replyTo: emailField().optional(),
});

/**
 * Validates and normalises a message.
 *
 * Returns problems rather than throwing so a caller can log a misconfigured
 * template and carry on — a broken notification email must not take down the
 * write it was reporting on.
 */
export function normaliseMessage(
  message: EmailMessage,
): { ok: true; message: NormalisedMessage } | { ok: false; problems: string[] } {
  const parsed = messageSchema.safeParse(message);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) =>
        issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
      ),
    };
  }
  return { ok: true, message: parsed.data };
}

/**
 * Parses `EMAIL_RECIPIENT_ALLOWLIST` into match entries.
 *
 * An entry is either a full address (`ben@180dc.org`) or a bare domain
 * (`180dc.org` or `@180dc.org`, both accepted — the `@` is easy to type out of
 * habit). An empty or unset value yields an empty list, which means no
 * restriction: see {@link partitionRecipients}.
 */
export function parseAllowlist(raw: string | undefined): readonly string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter((entry) => entry !== "");
}

/** Whether `address` matches any allowlist entry, by address or by domain. */
export function isAllowedRecipient(
  address: string,
  allowlist: readonly string[],
): boolean {
  const normalised = address.trim().toLowerCase();
  const domain = normalised.split("@")[1] ?? "";
  return allowlist.some((entry) => entry === normalised || entry === domain);
}

/**
 * Splits recipients into those the allowlist permits and those it does not.
 *
 * An empty allowlist permits everyone. That is the production configuration —
 * the guard exists for the environments where it must be impossible to email a
 * real charity contact by accident: a staging database seeded with real-looking
 * addresses, or a developer testing an invite flow against a sending domain
 * that is not 180DC's. Set `EMAIL_RECIPIENT_ALLOWLIST` there and a stray
 * recipient is dropped and logged instead of delivered.
 */
export function partitionRecipients(
  to: readonly string[],
  allowlist: readonly string[],
): { allowed: readonly string[]; blocked: readonly string[] } {
  if (allowlist.length === 0) return { allowed: to, blocked: [] };

  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const address of to) {
    (isAllowedRecipient(address, allowlist) ? allowed : blocked).push(address);
  }
  return { allowed, blocked };
}

/**
 * Masks an address for logging — enough to tell recipients apart, not enough to
 * put a contact's address in a log line. Mirrors `scrub`'s treatment in
 * `error-logging.ts`, which these logs sit alongside.
 */
export function maskAddress(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
