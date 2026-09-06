import "server-only";

import {
  resolveGmailConfig,
  resolveGmailSender,
  sendGmailMessage,
  type GmailSendResult,
} from "./gmail/client.ts";

/**
 * F179 (#175) — Email Notifications: the transport, and only the transport.
 *
 * DELIBERATELY NOT sendBranchOutreach (src/lib/gmail/branch-sender.ts). That
 * function's own header documents it as "the only transport entry point for
 * client outreach (F124)" and exists specifically so nothing else can send
 * as the branch's outreach voice without going through the approved,
 * human-reviewed OUTREACH_MESSAGES/scheduling pipeline. A platform
 * notification email to a CAM — "you have a reply" — is not outreach to a
 * client, has no approval step, and must never be reachable through, or
 * mistakable for, that path. This calls the lower-level sendGmailMessage
 * (F241) directly, with its own display name, and touches no outreach
 * table, RPC, or approval concept anywhere in its call graph. That is what
 * this ticket's own testing note ("verify no outreach email can be sent
 * without human approval") is actually asking to be true of this code, and
 * it is true by construction, not by an added check.
 *
 * sendGmailMessage still enforces its own F223 defence-in-depth (the `from`
 * address must match the configured branch mailbox), so this reuses the
 * same secure, non-hardcoded configuration (GMAIL_CLIENT_ID/SECRET/
 * REFRESH_TOKEN, GMAIL_SENDER_EMAIL) rather than a second credential set —
 * AC2.
 */

export type NotificationEmailInput = {
  to: string;
  subject: string;
  text: string;
};

const NOTIFICATION_SENDER_NAME = "180Connect";

/**
 * Sends one platform notification email. Best-effort by design — a failure
 * here must never take down whatever created the in-app notification that
 * prompted it; callers report and swallow, same as
 * scheduled-worker.ts's notifySendFailed.
 */
export async function sendNotificationEmail(
  input: NotificationEmailInput,
  options: {
    source?: Record<string, string | undefined>;
    send?: typeof sendGmailMessage;
  } = {},
): Promise<GmailSendResult> {
  const source = options.source ?? process.env;
  const config = resolveGmailConfig(source);
  const sender = resolveGmailSender(source);
  if (!config || !sender) {
    return {
      ok: false,
      retryable: false,
      reason: "Email notifications are not configured.",
    };
  }

  return (options.send ?? sendGmailMessage)(
    {
      from: `${NOTIFICATION_SENDER_NAME} <${sender}>`,
      to: input.to,
      subject: input.subject,
      text: input.text,
    },
    { config },
  );
}
