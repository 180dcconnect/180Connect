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
  created_at?: string;
  detail: { organisation_id?: unknown; provider_thread_id?: unknown; sent_to?: unknown };
};

function header(headers: readonly GmailHeader[], name: string): string {
  return headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value.trim() ?? "";
}

export function emailAddressOf(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

/** Keep unrelated inbox traffic out of CRM storage and review queues. */
export function isPotentialCrmReply(
  reply: ParsedInboundReply,
  rows: readonly SentThreadReference[],
  branchSender: string,
): boolean {
  if (emailAddressOf(reply.to) !== emailAddressOf(branchSender)) return false;
  return rows.some((row) =>
    row.detail.provider_thread_id === reply.providerThreadId ||
    (reply.hasReplyHeaders &&
      typeof row.detail.sent_to === "string" &&
      emailAddressOf(row.detail.sent_to) === emailAddressOf(reply.from)),
  );
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
  if (emailAddressOf(reply.to) !== emailAddressOf(branchSender)) return null;
  const candidates = rows.filter((row) => row.detail.provider_thread_id === reply.providerThreadId);
  const exact = candidates.find((row) =>
    typeof row.detail.sent_to === "string" && emailAddressOf(row.detail.sent_to) === emailAddressOf(reply.from),
  );
  if (exact) return exact;
  const legacy = candidates.length === 1 && typeof candidates[0].detail.sent_to !== "string";
  if (reply.hasReplyHeaders && legacy) return candidates[0];

  // F132 email fallback: only a message carrying reply ancestry may use it, and
  // every sent row for that address must resolve to the same organisation. This
  // catches provider thread drift without attaching ordinary inbound mail—or an
  // address shared by two client records—to whichever row happened to come first.
  if (!reply.hasReplyHeaders) return null;
  const senderMatches = rows.filter((row) =>
    typeof row.detail.sent_to === "string" && emailAddressOf(row.detail.sent_to) === emailAddressOf(reply.from),
  );
  const organisationIds = new Set(
    senderMatches
      .map((row) => row.detail.organisation_id)
      .filter((value): value is string => typeof value === "string"),
  );
  if (organisationIds.size !== 1) return null;
  return senderMatches.sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  )[0] ?? null;
}

export type ReviewFlagDetail = { provider_message_id?: unknown };

/**
 * A reply first flagged for manual review can later be captured, if a
 * subsequent sync run's sent-outreach snapshot resolves the match (see
 * capture_gmail_reply's gmail_reply_review_resolved write). Without this
 * filter the review queue would keep showing an item that is already sitting
 * on the client's timeline.
 */
export function excludeResolvedReviewFlags<T extends { detail: ReviewFlagDetail }>(
  rows: readonly T[],
  resolvedRows: readonly { detail: ReviewFlagDetail }[],
): T[] {
  const resolvedIds = new Set(
    resolvedRows
      .map((row) => row.detail.provider_message_id)
      .filter((value): value is string => typeof value === "string"),
  );
  return rows.filter((row) => {
    const id = row.detail.provider_message_id;
    return !(typeof id === "string" && resolvedIds.has(id));
  });
}
