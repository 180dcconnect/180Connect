import { randomUUID } from "node:crypto";

export type GmailMimeMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** F117: sanitized outreach HTML. Omitted, the message stays plain text only. */
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: readonly string[];
};

function header(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function crlf(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

/** Creates the RFC-compliant message accepted by users.messages.send. */
export function createGmailMime(message: GmailMimeMessage): string {
  const lines = [
    `From: ${header(message.from)}`,
    `To: ${header(message.to)}`,
    `Subject: ${header(message.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (message.messageId) lines.push(`Message-ID: ${header(message.messageId)}`);
  if (message.inReplyTo) lines.push(`In-Reply-To: ${header(message.inReplyTo)}`);
  if (message.references?.length) {
    lines.push(`References: ${message.references.map(header).join(" ")}`);
  }

  // F117: HTML is always sent alongside a plain-text part (multipart/alternative),
  // never HTML-only. A CAM's edits become real formatting AND stay readable in a
  // mail client that renders plain text only or strips HTML — the same email
  // either way, just two representations of it.
  if (message.html) {
    const boundary = `outreach-${randomUUID()}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      crlf(message.text),
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      crlf(message.html),
      "",
      `--${boundary}--`,
    ].join("\r\n");
    return `${lines.join("\r\n")}\r\n\r\n${body}`;
  }

  lines.push('Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit");
  return `${lines.join("\r\n")}\r\n\r\n${crlf(message.text)}`;
}

export function encodeGmailRaw(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}
