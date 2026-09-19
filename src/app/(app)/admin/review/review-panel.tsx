"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, History, Search, X } from "lucide-react";
import { Pill } from "@/app/(app)/clients/[id]/section-card";
import { FIELD_LABEL, INPUT, PRIMARY_BUTTON } from "@/app/settings/styles";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageSizeSelect, PagingSummary, useListPager } from "@/components/ui/list-pager";
import { NETWORK_ERROR_MESSAGE } from "@/lib/network-error";
import { reportError } from "@/lib/error-logging";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";

export type DataQualityEventRow = {
  id: string;
  raw_source_record_id: string;
  rule_name: string;
  rule_category: string;
  field_value: string | null;
  severity: string;
  suggested_fix: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
  raw_source_records: { raw_payload: unknown } | null;
};

export type StatusFlagRow = {
  id: string;
  organisation_id: string;
  source: string;
  company_number: string;
  previous_status: string;
  new_status: string;
  detected_at: string;
  resolved: boolean;
  resolved_at: string | null;
  organisations: { legal_name: string } | null;
};

export type UnmatchedReplyRow = {
  id: string;
  created_at: string;
  detail: {
    provider_message_id?: unknown;
    provider_thread_id?: unknown;
    sender_email?: unknown;
    subject?: unknown;
    reply_body?: unknown;
    received_at?: unknown;
  };
};

function detailText(row: UnmatchedReplyRow, key: keyof UnmatchedReplyRow["detail"]): string {
  const value = row.detail[key];
  return typeof value === "string" && value.trim() ? value : "";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB");
}

const RULE_LABEL: Record<string, string> = {
  client_criteria_needs_review: "Needs review",
  client_criteria_does_not_meet: "Does not meet criteria",
};

function ruleLabel(ruleName: string): string {
  // A rule the page does not know reads as a plain sentence, never as the
  // stored token: internal names are not something an admin should have to
  // decode (AGENTS.md, "Who will maintain this app").
  return RULE_LABEL[ruleName] ?? "Needs a look";
}

const SOURCE_LABEL: Record<string, string> = {
  companies_house: "Companies House",
  charity_commission: "Charity Commission",
};

function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? "Another register";
}

function recordName(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    // company_name (Companies House), charity_name (Charity Commission), name
    // (a fallback for any other source's raw_payload shape).
    const name = record.company_name ?? record.charity_name ?? record.name;
    if (typeof name === "string" && name.trim()) return name;
  }
  return "Unknown record";
}

/** The note box under each actionable item — the shared settings input. */
const NOTE_INPUT =
  "mt-1 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm leading-[1.65] text-ink outline-none focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 disabled:opacity-50";

type QueueTab = "unmatched" | "flags" | "events" | "history";

const TABS: readonly { id: QueueTab; label: string }[] = [
  { id: "unmatched", label: "Unmatched replies" },
  { id: "flags", label: "Status changes" },
  { id: "events", label: "Held for review" },
  { id: "history", label: "History" },
];

/**
 * The text search over one queue. A plain input, not the faceted BrandSearchBar:
 * each queue holds at most 200 rows and one question — whose name, address or
 * detail is this — so categories and filters would be machinery around a text
 * match. Live-filtered: the lists are already in memory, so every keystroke is
 * free and there is nothing to submit.
 */
function QueueSearch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  return (
    <div className="relative max-w-md">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
      />
      <input
        type="search"
        aria-label={label}
        placeholder="Search this queue"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${INPUT} pr-9 pl-9`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 inline-flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

/**
 * One queue item as a native `<details>` disclosure (the outreach history's
 * pattern): the collapsed row is a readable summary — name, the one fact that
 * matters, when — and opening it is what reveals the body, the note box and
 * the answer. No open/close state ships any JS for it; only the search, the
 * tabs and the pager are stateful.
 */
function QueueItem({
  summary,
  meta,
  children,
}: {
  summary: ReactNode;
  meta: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-panel border border-rule bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 focus-visible:rounded-panel focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{summary}</span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="hidden text-[13px] tabular-nums text-faint sm:block">{meta}</span>
          <ChevronDown
            aria-hidden="true"
            className="size-[15px] shrink-0 text-faint transition-transform group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="border-t border-rule-soft px-4 py-4 sm:px-5">{children}</div>
    </details>
  );
}

/** The celebratory empty state, in the approvals panel's voice. */
function EmptyQueue({
  title,
  body,
  searched,
  onClearSearch,
}: {
  title: string;
  body: string;
  searched: boolean;
  onClearSearch: () => void;
}) {
  return (
    <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-12 text-center">
      <Check className="mx-auto size-6 text-go" aria-hidden="true" />
      <h2 className="mt-3 font-body text-[18px] font-semibold tracking-[-0.01em] text-ink">
        {searched ? "Nothing matches your search" : title}
      </h2>
      <p className="mt-1 text-[13px] leading-[1.55] text-dim">
        {searched ? "Try a different name, address or detail." : body}
      </p>
      {searched && (
        <button type="button" onClick={onClearSearch} className={`${PRIMARY_BUTTON} mt-4`}>
          Clear search
        </button>
      )}
    </div>
  );
}

export function ReviewPanel({
  initialEvents,
  initialFlags,
  initialUnmatchedReplies,
  canReview = true,
}: {
  initialEvents: DataQualityEventRow[];
  initialFlags: StatusFlagRow[];
  initialUnmatchedReplies: UnmatchedReplyRow[];
  canReview?: boolean;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [flags, setFlags] = useState(initialFlags);
  const [unmatchedReplies, setUnmatchedReplies] = useState(initialUnmatchedReplies);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);

  // Each queue keeps its own search: switching tabs never loses what was typed.
  const [unmatchedQuery, setUnmatchedQuery] = useState("");
  const [flagsQuery, setFlagsQuery] = useState("");
  const [eventsQuery, setEventsQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");

  const openFlags = flags.filter((flag) => !flag.resolved);
  const openEvents = events.filter((event) => !event.resolved);
  const decidedFlags = flags.filter((flag) => flag.resolved);
  const decidedEvents = events.filter((event) => event.resolved);
  const decided = [...decidedFlags, ...decidedEvents].sort((a, b) =>
    (b.resolved_at ?? "").localeCompare(a.resolved_at ?? ""),
  );

  // Land where the work is: the first queue with anything waiting.
  const [activeTab, setActiveTab] = useState<QueueTab>(() => {
    if (initialUnmatchedReplies.length > 0) return "unmatched";
    if (initialFlags.some((flag) => !flag.resolved)) return "flags";
    if (initialEvents.some((event) => !event.resolved)) return "events";
    return "unmatched";
  });

  function switchTab(tab: QueueTab) {
    setActiveTab(tab);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const order = TABS.map((tab) => tab.id);
    const at = order.indexOf(activeTab);
    let nextTab: QueueTab | null = null;
    if (event.key === "ArrowRight") nextTab = order[(at + 1) % order.length] ?? null;
    if (event.key === "ArrowLeft") nextTab = order[(at - 1 + order.length) % order.length] ?? null;
    if (event.key === "Home") nextTab = order[0] ?? null;
    if (event.key === "End") nextTab = order[order.length - 1] ?? null;
    if (!nextTab) return;

    event.preventDefault();
    switchTab(nextTab);
    document.getElementById(`review-tab-${nextTab}`)?.focus();
  }

  const matchesQuery = (query: string, ...fields: (string | null | undefined)[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return fields.some((field) => field?.toLowerCase().includes(q));
  };

  const filteredUnmatched = unmatchedReplies.filter((reply) =>
    matchesQuery(
      unmatchedQuery,
      detailText(reply, "sender_email"),
      detailText(reply, "subject"),
      detailText(reply, "reply_body"),
    ),
  );
  const filteredFlags = openFlags.filter((flag) =>
    matchesQuery(
      flagsQuery,
      flag.organisations?.legal_name,
      flag.company_number,
      flag.previous_status,
      flag.new_status,
      sourceLabel(flag.source),
    ),
  );
  const filteredEvents = openEvents.filter((event) =>
    matchesQuery(
      eventsQuery,
      recordName(event.raw_source_records?.raw_payload),
      ruleLabel(event.rule_name),
      event.suggested_fix,
    ),
  );
  const filteredDecided = decided.filter((item) =>
    "organisations" in item
      ? matchesQuery(
          historyQuery,
          item.organisations?.legal_name,
          item.company_number,
          item.previous_status,
          item.new_status,
          sourceLabel(item.source),
        )
      : matchesQuery(
          historyQuery,
          recordName(item.raw_source_records?.raw_payload),
          ruleLabel(item.rule_name),
        ),
  );

  // Four lists, four pagers — fixed order, so the hooks never move. The pager
  // clamps a stale page back to the last real one, which is what keeps an
  // answered item from stranding the reader on an empty page.
  const unmatchedPager = useListPager(filteredUnmatched);
  const flagsPager = useListPager(filteredFlags);
  const eventsPager = useListPager(filteredEvents);
  const historyPager = useListPager(filteredDecided);

  const counts: Record<QueueTab, number> = {
    unmatched: unmatchedReplies.length,
    flags: openFlags.length,
    events: openEvents.length,
    history: decided.length,
  };

  async function refresh() {
    const response = await fetch("/api/admin/review");
    if (!response.ok) return;
    const body = await response.json();
    setEvents(body.events as DataQualityEventRow[]);
    setFlags(body.flags as StatusFlagRow[]);
    setUnmatchedReplies(body.unmatchedReplies as UnmatchedReplyRow[]);
  }

  async function decide(type: "data_quality_event" | "status_flag", id: string, successMessage: string) {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id, note: notes[id] ?? "" }),
      });
      const body = await response.json();
      if (!response.ok) {
        setStatus({ text: body.error ?? "The request could not be completed.", tone: "error" });
        return;
      }
      setStatus({ text: successMessage, tone: "success" });
      await refresh();
    } catch (err) {
      void reportError(err, { operation: "admin.review.decide_client" });
      setStatus({ text: NETWORK_ERROR_MESSAGE, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!canReview && (
        <div className="rounded-inset bg-paper px-4 py-3">
          <p className="text-[13px] leading-[1.55] text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
        </div>
      )}

      <div
        className="flex items-end gap-6 border-b border-rule"
        role="tablist"
        aria-label="Review queues"
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              id={`review-tab-${tab.id}`}
              onClick={() => switchTab(tab.id)}
              onKeyDown={handleTabKeyDown}
              tabIndex={active ? 0 : -1}
              className={`relative inline-flex cursor-pointer items-center gap-2 pb-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none ${
                active
                  ? "text-lead after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-lead"
                  : "text-dim hover:text-ink"
              }`}
              aria-controls={`review-panel-${tab.id}`}
              aria-selected={active}
              role="tab"
            >
              {tab.label}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
                  active ? "bg-lead-wash text-lead" : "bg-paper-sunk text-dim"
                }`}
              >
                {counts[tab.id]}
              </span>
            </button>
          );
        })}
      </div>

      {status && <InlineAlert tone={status.tone} message={status.text} />}

      <section
        id="review-panel-unmatched"
        role="tabpanel"
        aria-labelledby="review-tab-unmatched"
        hidden={activeTab !== "unmatched"}
      >
        <p className="text-[13px] leading-[1.55] text-dim">
          Gmail replies that could not be linked confidently by thread or sender. Review these
          manually; they have not been attached to any client.
        </p>
        <div className="mt-4 space-y-4">
          <QueueSearch
            value={unmatchedQuery}
            onChange={setUnmatchedQuery}
            label="Search unmatched replies by sender, subject or message"
          />
          {filteredUnmatched.length === 0 ? (
            <EmptyQueue
              title="No unmatched replies"
              body="Every reply found its client."
              searched={unmatchedQuery.trim().length > 0}
              onClearSearch={() => setUnmatchedQuery("")}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <PagingSummary summary={unmatchedPager} onPageChange={unmatchedPager.setPage} />
                {unmatchedPager.showPager && (
                  <PageSizeSelect
                    pageSize={unmatchedPager.pageSize}
                    onChange={unmatchedPager.setPageSize}
                  />
                )}
              </div>
              <ul className="space-y-3">
                {unmatchedPager.items.map((reply) => {
                  const sender = detailText(reply, "sender_email") || "Unknown sender";
                  const subject = detailText(reply, "subject") || "No subject";
                  const body = detailText(reply, "reply_body") || "No readable message body.";
                  const receivedAt = detailText(reply, "received_at") || reply.created_at;
                  return (
                    <li key={reply.id}>
                      <QueueItem
                        summary={
                          <>
                            <span className="block truncate font-medium text-ink">{subject}</span>
                            <span className="mt-0.5 block truncate text-[13px] text-dim">
                              From {sender}
                            </span>
                          </>
                        }
                        meta={`Received ${formatDateTime(receivedAt)}`}
                      >
                        <p className="text-[13px] tabular-nums text-faint sm:hidden">
                          Received {formatDateTime(receivedAt)}
                        </p>
                        <p className="mt-2 text-sm leading-[1.65] whitespace-pre-wrap text-ink sm:mt-0">
                          {body}
                        </p>
                      </QueueItem>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </section>

      <section
        id="review-panel-flags"
        role="tabpanel"
        aria-labelledby="review-tab-flags"
        hidden={activeTab !== "flags"}
      >
        <p className="text-[13px] leading-[1.55] text-dim">
          An organisation&apos;s Companies House or Charity Commission status changed away from
          active or registered. Outreach is never changed automatically — decide what, if
          anything, this means for any in-progress outreach.
        </p>
        <div className="mt-4 space-y-4">
          <QueueSearch
            value={flagsQuery}
            onChange={setFlagsQuery}
            label="Search status changes by client, number or status"
          />
          {filteredFlags.length === 0 ? (
            <EmptyQueue
              title="No status changes"
              body="Every client's register status still reads as active."
              searched={flagsQuery.trim().length > 0}
              onClearSearch={() => setFlagsQuery("")}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <PagingSummary summary={flagsPager} onPageChange={flagsPager.setPage} />
                {flagsPager.showPager && (
                  <PageSizeSelect pageSize={flagsPager.pageSize} onChange={flagsPager.setPageSize} />
                )}
              </div>
              <ul className="space-y-3">
                {flagsPager.items.map((flag) => (
                  <li key={flag.id}>
                    <QueueItem
                      summary={
                        <>
                          <span className="block truncate font-medium text-ink">
                            {flag.organisations?.legal_name ?? "Unknown client"}
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-dim">
                            {sourceLabel(flag.source)} {flag.company_number}: {flag.previous_status}{" "}
                            → {flag.new_status}
                          </span>
                        </>
                      }
                      meta={`Detected ${formatDateTime(flag.detected_at)}`}
                    >
                      <p className="text-[13px] tabular-nums text-faint sm:hidden">
                        Detected {formatDateTime(flag.detected_at)}
                      </p>
                      {canReview && (
                        <div className="mt-3">
                          <label
                            className={`${FIELD_LABEL} mb-1 block`}
                            htmlFor={`flag-note-${flag.id}`}
                          >
                            Note (optional)
                          </label>
                          <textarea
                            className={NOTE_INPUT}
                            disabled={busy}
                            id={`flag-note-${flag.id}`}
                            onChange={(event) =>
                              setNotes((current) => ({ ...current, [flag.id]: event.target.value }))
                            }
                            rows={2}
                            value={notes[flag.id] ?? ""}
                          />
                          <button
                            className={`${PRIMARY_BUTTON} mt-2`}
                            disabled={busy}
                            onClick={() => decide("status_flag", flag.id, "Acknowledged.")}
                            type="button"
                          >
                            Acknowledge
                          </button>
                        </div>
                      )}
                    </QueueItem>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section
        id="review-panel-events"
        role="tabpanel"
        aria-labelledby="review-tab-events"
        hidden={activeTab !== "events"}
      >
        <p className="text-[13px] leading-[1.55] text-dim">
          Records held out of the working list until there is evidence they are a non-profit or
          serve a social purpose.
        </p>
        <div className="mt-4 space-y-4">
          <QueueSearch
            value={eventsQuery}
            onChange={setEventsQuery}
            label="Search held records by name or reason"
          />
          {filteredEvents.length === 0 ? (
            <EmptyQueue
              title="No held records"
              body="Nothing is being held out of the working list."
              searched={eventsQuery.trim().length > 0}
              onClearSearch={() => setEventsQuery("")}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <PagingSummary summary={eventsPager} onPageChange={eventsPager.setPage} />
                {eventsPager.showPager && (
                  <PageSizeSelect
                    pageSize={eventsPager.pageSize}
                    onChange={eventsPager.setPageSize}
                  />
                )}
              </div>
              <ul className="space-y-3">
                {eventsPager.items.map((event) => (
                  <li key={event.id}>
                    <QueueItem
                      summary={
                        <>
                          <span className="block truncate font-medium text-ink">
                            {recordName(event.raw_source_records?.raw_payload)}
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-dim">
                            {ruleLabel(event.rule_name)}
                            {event.suggested_fix ? ` — ${event.suggested_fix}` : ""}
                          </span>
                        </>
                      }
                      meta={formatDateTime(event.created_at)}
                    >
                      <p className="text-[13px] tabular-nums text-faint sm:hidden">
                        {formatDateTime(event.created_at)}
                      </p>
                      {canReview && (
                        <div className="mt-3">
                          <label
                            className={`${FIELD_LABEL} mb-1 block`}
                            htmlFor={`event-note-${event.id}`}
                          >
                            Note (optional)
                          </label>
                          <textarea
                            className={NOTE_INPUT}
                            disabled={busy}
                            id={`event-note-${event.id}`}
                            onChange={(eventChange) =>
                              setNotes((current) => ({
                                ...current,
                                [event.id]: eventChange.target.value,
                              }))
                            }
                            rows={2}
                            value={notes[event.id] ?? ""}
                          />
                          <button
                            className={`${PRIMARY_BUTTON} mt-2`}
                            disabled={busy}
                            onClick={() => decide("data_quality_event", event.id, "Marked reviewed.")}
                            type="button"
                          >
                            Mark reviewed
                          </button>
                        </div>
                      )}
                    </QueueItem>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section
        id="review-panel-history"
        role="tabpanel"
        aria-labelledby="review-tab-history"
        hidden={activeTab !== "history"}
      >
        <p className="text-[13px] leading-[1.55] text-dim">
          Every item already answered, most recent first.
        </p>
        <div className="mt-4 space-y-4">
          <QueueSearch
            value={historyQuery}
            onChange={setHistoryQuery}
            label="Search decided items by name or detail"
          />
          {filteredDecided.length === 0 ? (
            <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-12 text-center">
              <History className="mx-auto size-6 text-faint" aria-hidden="true" />
              <h2 className="mt-3 font-body text-[18px] font-semibold tracking-[-0.01em] text-ink">
                {historyQuery.trim() ? "Nothing matches your search" : "Nothing decided yet"}
              </h2>
              <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                {historyQuery.trim()
                  ? "Try a different name or detail."
                  : "Answered items will stay here as a readable record."}
              </p>
              {historyQuery.trim() && (
                <button
                  type="button"
                  onClick={() => setHistoryQuery("")}
                  className={`${PRIMARY_BUTTON} mt-4`}
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <PagingSummary summary={historyPager} onPageChange={historyPager.setPage} />
                {historyPager.showPager && (
                  <PageSizeSelect
                    pageSize={historyPager.pageSize}
                    onChange={historyPager.setPageSize}
                  />
                )}
              </div>
              <div className="rounded-panel border border-rule bg-white px-4 sm:px-5">
                <ul className="divide-y divide-rule-soft">
                  {historyPager.items.map((item) =>
                    "organisations" in item ? (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-3.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            {item.organisations?.legal_name ?? "Unknown client"}
                          </p>
                          <p className="mt-0.5 text-[13px] text-dim">
                            {sourceLabel(item.source)}: {item.previous_status} → {item.new_status}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <Pill tone="neutral" dot={false}>
                            Status change
                          </Pill>
                          <span className="text-[13px] tabular-nums text-faint">
                            {item.resolved_at ? formatDateTime(item.resolved_at) : "—"}
                          </span>
                        </div>
                      </li>
                    ) : (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-3.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            {recordName(item.raw_source_records?.raw_payload)}
                          </p>
                          <p className="mt-0.5 text-[13px] text-dim">{ruleLabel(item.rule_name)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <Pill tone="neutral" dot={false}>
                            Held record
                          </Pill>
                          <span className="text-[13px] tabular-nums text-faint">
                            {item.resolved_at ? formatDateTime(item.resolved_at) : "—"}
                          </span>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
