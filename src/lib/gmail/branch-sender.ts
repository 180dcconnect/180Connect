import { resolveGmailConfig, resolveGmailSender, sendGmailMessage } from "./client.ts";

export type BranchEmail = {
  to: string;
  subject: string;
  text: string;
  /** F117: sanitized outreach HTML. Omitted, the email sends as plain text only. */
  html?: string;
  inReplyTo?: string;
  references?: readonly string[];
  threadId?: string;
};

/**
 * The only transport entry point for client outreach (F124).
 *
 * Sender identity is deployment configuration, never user input. An absent or
 * partial Gmail setup blocks the send; it must never fall back to a CAM's
 * account or to the transactional Resend transport.
 */
export async function sendBranchOutreach(
  email: BranchEmail,
  options: {
    source?: Record<string, string | undefined>;
    send?: typeof sendGmailMessage;
  } = {},
) {
  const source = options.source ?? process.env;
  const config = resolveGmailConfig(source);
  const sender = resolveGmailSender(source);
  if (!config || !sender) {
    return {
      ok: false as const,
      retryable: false,
      reason: "The branch outreach mailbox is not configured.",
    };
  }

  return (options.send ?? sendGmailMessage)(
    {
      from: `180 Degrees Sheffield <${sender}>`,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      inReplyTo: email.inReplyTo,
      references: email.references,
    },
    { config, threadId: email.threadId },
  );
}
