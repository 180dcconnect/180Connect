export type GmailMimeMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId?: string;
  inReplyTo?: string;
  references?: readonly string[];
};

function header(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Creates the RFC-compliant plain-text message accepted by users.messages.send. */
export function createGmailMime(message: GmailMimeMessage): string {
  const lines = [
    `From: ${header(message.from)}`,
    `To: ${header(message.to)}`,
    `Subject: ${header(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  if (message.messageId) lines.push(`Message-ID: ${header(message.messageId)}`);
  if (message.inReplyTo) lines.push(`In-Reply-To: ${header(message.inReplyTo)}`);
  if (message.references?.length) {
    lines.push(`References: ${message.references.map(header).join(" ")}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n${message.text.replace(/\r?\n/g, "\r\n")}`;
}

export function encodeGmailRaw(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}
