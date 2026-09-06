/**
 * The shape the inbox renders a thread in — one thread per organisation,
 * carrying everything the mailbox shell needs to draw a row, a folder and a
 * reading pane.
 *
 * This type used to be called `InboxThreadView` and lived in `inbox-mock-data.ts`,
 * back when the mailbox was a design harness with nothing behind it. It is now
 * what `/inbox` speaks: `buildRealInboxThreads` (./inbox/real-threads.ts)
 * builds these from Supabase rows, and the mock set in `inbox-mock-data.ts`
 * fills in behind them. Nothing here is mock-specific — the mock bends to this
 * shape, not the other way round.
 *
 * The pure helpers below travel with the type because they only read it:
 * formatting for the row's timestamp column, the file-size label, the date
 * filter vocabulary shared with the import-status picker, and the ranked search
 * the suggestion dropdown previews.
 */

export type InboxAttachmentView = {
  id: string;
  filename: string;
  fileType: "pdf" | "docx" | "xlsx" | "pptx" | "png";
  sizeBytes: number;
  downloadUrl?: string;
};

export type InboxEmailMessage = {
  id: string;
  senderName: string;
  senderEmail: string;
  senderRole?: string;
  recipientName: string;
  recipientEmail: string;
  sentAt: string; // ISO timestamp
  subject: string;
  body: string;
  isFromClient: boolean;
  intent?: "interested" | "not_interested" | "more_info" | "referral" | null;
  attachments?: InboxAttachmentView[];
};

export type InboxThreadView = {
  id: string; // Organisation ID
  orgName: string;
  orgType: string;
  city: string;
  country: string;
  sector: "Charities & NGOs" | "Health & Well-being" | "Youth & Education" | "Environment" | "Grants & Foundations";
  labelColor: string;
  primaryContact: {
    name: string;
    role: string;
    email: string;
    phone?: string;
  };
  camOwner: {
    name: string;
    email: string;
    avatarUrl?: string;
  };
  status: "replied" | "awaiting" | "sent" | "draft";
  replyIntent?: "interested" | "not_interested" | "more_info" | "referral" | null;
  subject: string;
  snippet: string;
  lastActivityAt: string;
  isRead: boolean;
  isStarred: boolean;
  isImportant: boolean;
  folder:
    | "inbox"
    | "starred"
    | "snoozed"
    | "scheduled"
    | "sent"
    | "drafts"
    | "archive"
    | "trash";
  /** When a scheduled send is due. Only set on `folder: "scheduled"` threads. */
  scheduledFor?: string;
  messages: InboxEmailMessage[];
  attachments: InboxAttachmentView[];
  notesCount: number;
  handoversCount: number;
};

/** Sector → label colour. Fixed, so a thread's label is stable across renders
    without a colour ever being stored. */
export const SECTOR_COLORS: Record<InboxThreadView["sector"], string> = {
  "Health & Well-being": "#0ea5e9",
  "Charities & NGOs": "#10b981",
  "Youth & Education": "#8b5cf6",
  "Environment": "#14b8a6",
  "Grants & Foundations": "#f59e0b",
};

/**
 * Returns formatted relative time similar to Gmail.
 */
export function formatGmailTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMins < 60) {
    return `${Math.max(1, diffMins)}m ago`;
  }
  if (diffHours < 24 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1 || (diffHours < 48 && date.getDate() === now.getDate() - 1)) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return date.toLocaleDateString("en-GB", { weekday: "short" });
  }
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Full "will send at" phrasing for the scheduled-send banner in the reading
    pane: "Friday, 6 September at 09:00". */
export function formatScheduledFor(isoDate: string): string {
  const date = new Date(isoDate);
  const day = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day} at ${time}`;
}

/** Compact scheduled time for the thread row's right column: "6 Sep, 09:00". */
export function formatScheduledShort(isoDate: string): string {
  const date = new Date(isoDate);
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/**
 * Formats file size in readable KB / MB.
 */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1000000) {
    return `${(bytes / 1000000).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1000)} KB`;
}

/**
 * Resolves one date-filter value to an inclusive millisecond range, using the
 * same value vocabulary as the import-status date filter (`today`,
 * `yesterday`, `7d`, `30d`, `this_month`, `last_month`, a single `YYYY-MM-DD`
 * day, or a `from..to` range) so the two pickers agree. Returns null for
 * anything unparseable — callers ignore those rather than matching nothing.
 */
export function resolveDateFilter(
  value: string,
  now: Date = new Date(),
): { from: number; to: number } | null {
  const startOfDay = (date: Date): Date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = (date: Date): Date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const addDays = (date: Date, days: number): Date => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };

  const today = startOfDay(now);
  if (value === "today") {
    return { from: today.getTime(), to: endOfDay(now).getTime() };
  }
  if (value === "yesterday") {
    const day = addDays(today, -1);
    return { from: day.getTime(), to: endOfDay(day).getTime() };
  }
  if (value === "7d" || value === "30d") {
    const days = value === "7d" ? 7 : 30;
    return { from: addDays(today, -days).getTime(), to: endOfDay(now).getTime() };
  }
  if (value === "this_month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: first.getTime(), to: endOfDay(now).getTime() };
  }
  if (value === "last_month") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: first.getTime(), to: endOfDay(last).getTime() };
  }
  if (value.includes("..")) {
    const [fromStr, toStr] = value.split("..");
    const from = new Date(`${fromStr}T00:00:00`);
    const to = new Date(`${toStr}T00:00:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    const [start, end] = from <= to ? [from, to] : [to, from];
    return { from: startOfDay(start).getTime(), to: endOfDay(end).getTime() };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = new Date(`${value}T00:00:00`);
    if (Number.isNaN(day.getTime())) return null;
    return { from: startOfDay(day).getTime(), to: endOfDay(day).getTime() };
  }
  return null;
}
/**
 * Ranked free-text search over threads for the preview inbox: the suggestion
 * dropdown previews it live, Enter applies it to the list. Organisation name
 * outranks subject, which outranks snippet and contact name; ties keep file
 * order so screenshots are stable. A blank query matches nothing — the caller
 * decides what an empty search means.
 */
export function searchThreads(threads: InboxThreadView[], rawQuery: string): InboxThreadView[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  return threads
    .map((thread, index) => {
      const org = thread.orgName.toLowerCase();
      const subject = thread.subject.toLowerCase();
      let score = 0;
      if (org.startsWith(query)) score += 4;
      else if (org.includes(query)) score += 3;
      if (subject.startsWith(query)) score += 3;
      else if (subject.includes(query)) score += 2;
      if (thread.snippet.toLowerCase().includes(query)) score += 1;
      if (thread.primaryContact.name.toLowerCase().includes(query)) score += 1;
      return { thread, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.thread);
}
