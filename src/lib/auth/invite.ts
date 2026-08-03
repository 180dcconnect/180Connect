/**
 * The invite decision (F008), separated from the Server Action that calls it —
 * same reasoning as `src/lib/auth/login.ts`: a "use server" module cannot be
 * imported by `node --test`, so the part worth testing (domain restriction, the
 * duplicate-email check, the shape of every outcome) lives here behind
 * injectable clients, and the action keeps only client construction.
 */

import { z } from "zod";

import { logSecurityEvent } from "../log-security-event.ts";
import { emailField, safeValidate } from "../validation.ts";
import { allowedEmailDomain } from "./login.ts";

export function inviteSchema(domain: string = allowedEmailDomain()) {
  return z.object({
    email: emailField("Enter a valid email address.").refine(
      (email) => email.endsWith(`@${domain}`),
      { message: `Use a @${domain} email address.` },
    ),
  });
}

export type InviteState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: { email?: string[] };
};

/**
 * Shown for an email that already has a row in `public.users` — active account
 * or invite already pending, this repo's schema cannot cheaply tell those two
 * apart (see the module doc), and the acceptance criteria only requires the
 * message be specific, not which one it was.
 */
export const DUPLICATE_INVITE_MESSAGE =
  "This email already has an account or a pending invite.";

/**
 * Looks up an existing `public.users` row by email, or returns `null`.
 *
 * A plain function rather than a slice of the Supabase client's method chain:
 * the real query builder is a thenable, not a `Promise`, and structurally
 * matching its chained `.from().select().eq().maybeSingle()` shape is more
 * trouble than it is worth (TypeScript rejects it as an excessively deep
 * instantiation). The caller wraps whichever Supabase client it holds; the fake
 * in `invite.test.ts` is just a function.
 */
export type LookupExistingUser = (email: string) => Promise<{ id: string } | null>;

/** Minimal slice of the Supabase Admin API this module needs to send the invite. */
export type InviteAdminClient = {
  auth: {
    admin: {
      inviteUserByEmail: (
        email: string,
        options?: { redirectTo?: string; data?: Record<string, unknown> },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

export type SendInviteInput = { email: unknown };

export type SendInviteOutcome =
  | { ok: true; state: InviteState }
  | { ok: false; state: InviteState };

/**
 * Validates the email, checks nobody already holds it, and — only if both pass —
 * asks Supabase Auth to mint a single-use invite token and email it. Supabase is
 * the token authority here rather than a hand-rolled one: it already generates,
 * stores and expires it, and `docs/auth/invite-email.md` points the dashboard
 * template at the same `{{ .TokenHash }}` shape `docs/auth/recovery-email.md`
 * uses for password reset.
 *
 * Never throws: a lookup or send failure comes back as a state the caller can
 * render, matching `attemptLogin`'s contract.
 */
export async function sendInvite(
  lookupExistingUser: LookupExistingUser,
  adminClient: InviteAdminClient,
  invitedByUserId: string,
  input: SendInviteInput,
  redirectTo: string,
  domain: string = allowedEmailDomain(),
): Promise<SendInviteOutcome> {
  const result = safeValidate(inviteSchema(domain), { email: input.email });

  if (!result.success) {
    logSecurityEvent("validation.rejected", {
      form: "invite",
      fields: Object.keys(result.fieldErrors).join(","),
    });
    return {
      ok: false,
      state: {
        status: "error",
        message: "Check the highlighted field and try again.",
        fieldErrors: result.fieldErrors,
      },
    };
  }

  const { email } = result.data;

  let existing: { id: string } | null;
  try {
    existing = await lookupExistingUser(email);
  } catch (error) {
    logSecurityEvent("user.invite_failed", {
      cause: error instanceof Error ? error.message : "lookup failed",
    });
    return {
      ok: false,
      state: { status: "error", message: "Could not check this email. Try again." },
    };
  }

  if (existing) {
    logSecurityEvent("user.invite_rejected", { reason: "duplicate" });
    return {
      ok: false,
      state: {
        status: "error",
        message: DUPLICATE_INVITE_MESSAGE,
        fieldErrors: { email: [DUPLICATE_INVITE_MESSAGE] },
      },
    };
  }

  try {
    const { error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { invited_by_user_id: invitedByUserId },
    });

    if (error) throw new Error(error.message);
  } catch (error) {
    logSecurityEvent("user.invite_failed", {
      cause: error instanceof Error ? error.message : "invite send failed",
    });
    return {
      ok: false,
      state: { status: "error", message: "Could not send the invite. Try again." },
    };
  }

  logSecurityEvent("user.invited", {});
  return {
    ok: true,
    state: { status: "success", message: `Invite sent to ${email}.` },
  };
}
