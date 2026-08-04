/**
 * Transactional email sending.
 *
 * One entry point — {@link sendEmail} — behind which sits a transport chosen
 * from the environment:
 *
 *   - **resend**  when `RESEND_API_KEY` is set. Posts to Resend's REST API.
 *   - **console** otherwise. Logs the message and sends nothing.
 *
 * Console is the default on purpose. A developer who has not configured
 * anything gets a readable record of what would have been sent, and a test run
 * cannot email a real person. Sending is something you switch on.
 *
 * Resend is reached over plain `fetch` rather than its SDK, matching how
 * `error-logging.ts` posts to Sentry: the API is one POST, and a dependency
 * that wraps one POST is a dependency to keep upgraded for no benefit.
 *
 * Swapping provider means adding a transport here. Nothing above this module
 * knows which one is in use, which is the point — the sending domain is a
 * deployment decision, not an application one.
 */

import { reportError } from "../error-logging.ts";
import {
  maskAddress,
  normaliseMessage,
  parseAllowlist,
  partitionRecipients,
  type EmailMessage,
  type NormalisedMessage,
} from "./message.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** How long we wait on the provider before giving up. */
const SEND_TIMEOUT_MS = 10_000;

/** Which transport {@link sendEmail} will use. */
export type TransportName = "resend" | "console";

export type EmailConfig = {
  transport: TransportName;
  /** Provider credential. Present only when `transport` is "resend". */
  apiKey?: string;
  /**
   * The `From` header, either a bare address or `Name <address>`. Must be on a
   * domain verified with the provider — an unverified sender is rejected.
   */
  from: string;
  /** Recipient guard. Empty means no restriction — see `partitionRecipients`. */
  allowlist: readonly string[];
};

export type SendResult =
  /** Handed to the provider, which accepted it. `id` is the provider's. */
  | { status: "sent"; id: string; recipients: readonly string[] }
  /** Deliberately not sent: console transport, or every recipient blocked. */
  | { status: "skipped"; reason: string }
  /** Tried and failed, or refused to try. The caller decides what that means. */
  | { status: "failed"; reason: string };

/**
 * Reads transport configuration from the environment.
 *
 * Takes the environment as an argument so the failure paths are testable
 * without mutating global state, following `collectEnvProblems` in `env.ts`.
 */
export function resolveEmailConfig(
  source: Record<string, string | undefined> = process.env,
): EmailConfig {
  const apiKey = source.RESEND_API_KEY?.trim();
  const allowlist = parseAllowlist(source.EMAIL_RECIPIENT_ALLOWLIST);
  const from = source.EMAIL_FROM?.trim() ?? "";

  if (!apiKey) {
    return { transport: "console", from, allowlist };
  }
  return { transport: "resend", apiKey, from, allowlist };
}

/** Renders the message as one structured log line, with recipients masked. */
function describeForLog(message: NormalisedMessage, config: EmailConfig) {
  return {
    transport: config.transport,
    from: config.from || "(unset)",
    to: message.to.map(maskAddress),
    subject: message.subject,
    bytes: message.text.length + (message.html?.length ?? 0),
  };
}

/**
 * Posts the message to Resend.
 *
 * Resend's error responses carry a JSON `message` explaining the refusal — an
 * unverified `from` domain and an over-quota key look identical at the status
 * code alone, so the body is what gets surfaced.
 */
async function sendViaResend(
  message: NormalisedMessage,
  config: EmailConfig,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [...message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    await reportError(error, { scope: "email.send", transport: "resend" });
    return { status: "failed", reason: "Could not reach the email provider." };
  }

  const body = (await response.json().catch(() => null)) as
    | { id?: string; message?: string; name?: string }
    | null;

  if (!response.ok) {
    const detail = body?.message ?? `HTTP ${response.status}`;
    await reportError(new Error(`Resend rejected the message: ${detail}`), {
      scope: "email.send",
      status: response.status,
      resendError: body?.name,
    });
    return { status: "failed", reason: detail };
  }

  if (!body?.id) {
    return { status: "failed", reason: "Provider accepted the message without an id." };
  }

  return { status: "sent", id: body.id, recipients: message.to };
}

/**
 * Validates, guards, and sends a transactional email.
 *
 * Never throws. Every outcome — including a provider outage — comes back as a
 * {@link SendResult}, because the callers are things like "invite a user" and
 * "notify the owning CAM", and neither should fail the action it is reporting
 * on just because mail is down. Callers that need the user to know should read
 * the result and say so.
 */
export async function sendEmail(
  message: EmailMessage,
  config: EmailConfig = resolveEmailConfig(),
): Promise<SendResult> {
  const normalised = normaliseMessage(message);
  if (!normalised.ok) {
    const reason = `Message is not valid: ${normalised.problems.join("; ")}`;
    await reportError(new Error(reason), { scope: "email.send" });
    return { status: "failed", reason };
  }

  const { allowed, blocked } = partitionRecipients(
    normalised.message.to,
    config.allowlist,
  );

  if (blocked.length > 0) {
    // Loud but not fatal: the guard doing its job is worth seeing in the logs
    // of whichever environment set an allowlist.
    console.warn(
      `[email] blocked ${blocked.length} recipient(s) not on EMAIL_RECIPIENT_ALLOWLIST: ` +
        blocked.map(maskAddress).join(", "),
    );
  }

  if (allowed.length === 0) {
    return {
      status: "skipped",
      reason: "Every recipient was blocked by EMAIL_RECIPIENT_ALLOWLIST.",
    };
  }

  const toSend: NormalisedMessage = { ...normalised.message, to: allowed };

  if (config.transport === "console") {
    console.info(`[email] ${JSON.stringify(describeForLog(toSend, config))}`);
    console.info(`[email] body:\n${toSend.text}`);
    return { status: "skipped", reason: "No RESEND_API_KEY set; logged instead of sent." };
  }

  if (!config.from) {
    const reason = "EMAIL_FROM is not set, so there is no verified sender to send from.";
    await reportError(new Error(reason), { scope: "email.send" });
    return { status: "failed", reason };
  }

  return sendViaResend(toSend, config);
}
