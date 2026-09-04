import { randomUUID } from "node:crypto";

export type GmailMimeAttachment = {
  filename: string;
  contentType: string | null;
  content: Buffer;
};

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
  /** F217: files to send as real MIME attachments, not just referenced. */
  attachments?: readonly GmailMimeAttachment[];
};

function header(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function crlf(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

/** The existing multipart/alternative-or-plain-text body, as a standalone MIME string. */
function buildBody(message: Pick<GmailMimeMessage, "text" | "html">): string {
  if (message.html) {
    const boundary = `outreach-${randomUUID()}`;
    return [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
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
  }
  return [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    crlf(message.text),
  ].join("\r\n");
}

/** One `Content-Disposition: attachment` MIME part, base64-encoded. */
function buildAttachmentPart(attachment: GmailMimeAttachment): string {
  const base64 = attachment.content.toString("base64");
  // RFC 2045 caps encoded lines at 76 characters — most mail infrastructure
  // tolerates longer lines, but Gmail's own API is the one consumer here and
  // wrapping costs nothing.
  const wrapped = base64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
  const filename = header(attachment.filename).replace(/"/g, "'");
  return [
    `Content-Type: ${attachment.contentType || "application/octet-stream"}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapped,
  ].join("\r\n");
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

  // bodyPart's own first line(s) are Content-Type (and Content-Transfer-
  // Encoding, for the plain-text case) headers, followed by a blank line and
  // its content — so it joins onto `lines` with a single \r\n, continuing the
  // same header block, exactly like the pre-F217 shape did. Only a single
  // \r\n\r\n may ever appear between the outer headers and the body: an
  // extra one here would end the header block early and turn Content-Type
  // into unparsed body text.
  const bodyPart = buildBody(message);

  // F217: attachments wrap the existing body (plain or multipart/alternative)
  // as the first part of an outer multipart/mixed envelope — bodyPart's
  // self-contained header+blank+content shape is exactly what a nested MIME
  // part looks like, so it drops in unchanged after the boundary marker. No
  // attachments, no change to the pre-F217 shape.
  if (message.attachments?.length) {
    const boundary = `outreach-mixed-${randomUUID()}`;
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      bodyPart,
      "",
      ...message.attachments.flatMap((attachment) => [`--${boundary}`, buildAttachmentPart(attachment), ""]),
      `--${boundary}--`,
    ].join("\r\n");
    return `${lines.join("\r\n")}\r\n${parts}`;
  }

  return `${lines.join("\r\n")}\r\n${bodyPart}`;
}

export function encodeGmailRaw(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}
