export type GmailHeader = { name: string; value: string };

export type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

export type GmailInboundMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailMessagePart & { headers?: GmailHeader[] };
};

export type ParsedInboundReply = {
  providerMessageId: string;
  providerThreadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: string;
  hasReplyHeaders: boolean;
};

export type SentThreadReference = {
  target_id: string;
  detail: { organisation_id?: unknown; provider_thread_id?: unknown; sent_to?: unknown };
};

function header(headers: readonly GmailHeader[], name: string): string {
  return headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value.trim() ?? "";
}

export function emailAddressOf(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function textParts(part: GmailMessagePart | undefined, mimeType: string): string[] {
  if (!part) return [];
  const own = part.mimeType === mimeType && part.body?.data
    ? [decodeBase64Url(part.body.data)]
    : [];
  return [...own, ...(part.parts ?? []).flatMap((child) => textParts(child, mimeType))];
}

function htmlToText(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanBody(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function isAutomatedInbound(headers: readonly GmailHeader[]): boolean {
  const from = emailAddressOf(header(headers, "From"));
  const subject = header(headers, "Subject").toLowerCase();
  const autoSubmitted = header(headers, "Auto-Submitted").toLowerCase();
  const precedence = header(headers, "Precedence").toLowerCase();
  return (
    (autoSubmitted !== "" && autoSubmitted !== "no") ||
    ["bulk", "junk", "list"].includes(precedence) ||
    Boolean(header(headers, "X-Autoreply")) ||
    Boolean(header(headers, "X-Autorespond")) ||
    Boolean(header(headers, "X-Auto-Response-Suppress")) ||
    /(^|[.@_-])(mailer-daemon|postmaster)([.@_-]|$)/i.test(from) ||
    /\b(out of office|automatic reply|auto reply|delivery status notification|undeliver(?:ed|able)|mail delivery failed)\b/i.test(subject)
  );
}

export function parseInboundReply(message: GmailInboundMessage): ParsedInboundReply | null {
  const headers = message.payload?.headers ?? [];
  if (!message.id || !message.threadId || isAutomatedInbound(headers)) return null;

  const plain = textParts(message.payload, "text/plain").join("\n");
  const html = textParts(message.payload, "text/html").join("\n");
  const body = cleanBody(plain || htmlToText(html));
  const from = emailAddressOf(header(headers, "From"));
  const to = emailAddressOf(header(headers, "To"));
  if (!from || !to || !body) return null;

  const millis = Number(message.internalDate);
  const receivedDate = Number.isFinite(millis) && millis > 0
    ? new Date(millis)
    : new Date(header(headers, "Date"));
  if (Number.isNaN(receivedDate.getTime())) return null;
  const receivedAt = receivedDate.toISOString();

  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    from,
    to,
    subject: header(headers, "Subject"),
    body,
    receivedAt,
    hasReplyHeaders: Boolean(header(headers, "In-Reply-To") || header(headers, "References")),
  };
}

/** Requires the Gmail thread and reviewed recipient to agree. Reply headers are
 * only a fallback for legacy sends whose audit row predates sent_to capture. */
export function matchInboundReply(
  reply: ParsedInboundReply,
  rows: readonly SentThreadReference[],
  branchSender: string,
): SentThreadReference | null {
  if (reply.to !== branchSender.toLowerCase()) return null;
  const candidates = rows.filter((row) => row.detail.provider_thread_id === reply.providerThreadId);
  if (candidates.length === 0) return null;
  const exact = candidates.find((row) =>
    typeof row.detail.sent_to === "string" && row.detail.sent_to.toLowerCase() === reply.from,
  );
  if (exact) return exact;
  const legacy = candidates.length === 1 && typeof candidates[0].detail.sent_to !== "string";
  return reply.hasReplyHeaders && legacy ? candidates[0] : null;
}
