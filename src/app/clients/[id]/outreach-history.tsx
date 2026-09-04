"use client";

import { useState } from "react";
import {
  describeSendStatus,
  describeStatusFilter,
  filterOutreachHistory,
  STATUS_FILTERS,
  type EmailThreadEntry,
  type OutreachHistory as OutreachHistoryData,
  type StatusFilter,
} from "@/lib/outreach-history";
import { isRichEmailHtml, sanitizeEmailHtml } from "@/lib/outreach/email-html";
import { FollowUpButton } from "./follow-up-button";
import { AddNoteForm } from "./add-note-form";

type ReplyDraftControls = {
  organisationId: string;
  blocked: boolean;
  ownershipBlocked: boolean;
  suppressionReason?: string;
  ownershipWarning?: string;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * F117: a row's body is either legacy plain text (sent before this feature)
 * or HTML from the rich-text editor — `isRichEmailHtml` tells them apart so
 * both keep rendering correctly with no data migration. The HTML branch
 * re-sanitizes on every render rather than trusting what was stored, so a
 * write path that ever skipped sanitizing still can't reach
 * `dangerouslySetInnerHTML` unsanitized.
 */
function EmailBodyPreview({ body }: { body: string }) {
  if (isRichEmailHtml(body)) {
    return (
      <div
        className="mt-2 text-sm text-foreground/80 [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-black/15 [&_blockquote]:pl-3 [&_blockquote]:text-foreground/70 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(body) }}
      />
    );
  }
  return <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{body}</p>;
}

function StatusBadge({ status }: { status: OutreachHistoryData["sent"][number]["send_status"] }) {
  const failed = status === "failed";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
        failed ? "bg-destructive/10 text-destructive" : "bg-black/5 text-foreground/70"
      }`}
    >
      {describeSendStatus(status)}
    </span>
  );
}

function FullEmailThread({
  entries,
  error,
  replyDraftControls,
  noteOrganisationId,
}: {
  entries: readonly EmailThreadEntry[];
  error: boolean;
  replyDraftControls?: ReplyDraftControls;
  noteOrganisationId?: string;
}) {
  return (
    <section id="email-thread" aria-labelledby="email-thread-heading" className="mt-5 scroll-mt-24 rounded-xl border border-black/10 bg-black/[0.02] p-4">
      <h3 id="email-thread-heading" className="text-sm font-bold text-foreground">
        Full email thread
      </h3>
      <p className="mt-1 text-xs text-foreground/60">
        Sent emails and client replies, oldest first.
      </p>

      {error ? (
        <p className="mt-3 text-sm font-medium text-red-800" role="alert">
          The full email thread could not be loaded. Refresh and try again.
        </p>
      ) : entries.length === 0 ? (
        <p className="mt-3 text-sm text-foreground/65">
          No sent emails or replies are available for this client yet.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {entries.map((entry) => {
            const incoming = entry.kind === "incoming";
            return (
              <li
                id={incoming ? `thread-reply-${entry.id}` : `thread-email-${entry.id}`}
                key={`${entry.kind}-${entry.id}`}
                className={`scroll-mt-24 rounded-xl border p-3 ${
                  incoming
                    ? "ml-0 mr-6 border-brand/20 bg-brand/5"
                    : "ml-6 mr-0 border-black/10 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-foreground/60">
                      {incoming ? "Client replied" : "180Connect sent"}
                    </p>
                    {entry.subject && <p className="mt-0.5 text-sm font-semibold">{entry.subject}</p>}
                  </div>
                  <time className="text-xs text-foreground/55" dateTime={entry.occurredAt}>
                    {new Date(entry.occurredAt).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <EmailBodyPreview body={entry.body} />
                {incoming && replyDraftControls && (
                  <div className="mt-3 border-t border-brand/10 pt-3">
                    <FollowUpButton
                      {...replyDraftControls}
                      replyEventId={entry.id}
                    />
                  </div>
                )}
                {incoming && noteOrganisationId && (
                  <div className="mt-3 border-t border-brand/10 pt-3">
                    <AddNoteForm
                      organisationId={noteOrganisationId}
                      replyEventId={entry.id}
                    />
                  </div>
                )}
                {!incoming && (
                  <p className="mt-2 text-xs text-foreground/55">
                    Sent by {entry.senderName || "a former team member"}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * F070/F130: a client's outreach history, split into what the client has
 * actually received (F070 AC1) and what has not reached them yet (AC3), with
 * F130's status filter over the whole set. Each row is a native
 * `<details>`/`<summary>` disclosure rather than a client component with its
 * own open/close state — "can be opened to view the full content" needs no
 * more than that, so it works without shipping any JS for it; only the
 * filter itself is stateful.
 */
export function OutreachHistorySection({
  history,
  error,
  thread,
  threadError,
  replyDraftControls,
  noteOrganisationId,
}: {
  history: OutreachHistoryData;
  error: boolean;
  thread: readonly EmailThreadEntry[];
  threadError: boolean;
  replyDraftControls?: ReplyDraftControls;
  noteOrganisationId?: string;
}) {
  // F130 AC3: filter selection is view state, not data state — it lives here,
  // never in the query, so the sent/not-sent grouping above it cannot drift.
  const [filter, setFilter] = useState<StatusFilter>("all");
  const filtered = filterOutreachHistory(history, filter);
  const nothingMatches =
    filter !== "all" && filtered.sent.length === 0 && filtered.notSent.length === 0;

  if (error) {
    return (
      <p className="mt-3 text-sm font-medium text-red-800" role="alert">
        Outreach history could not be loaded. Refresh and try again.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <a className="text-sm font-semibold text-brand underline underline-offset-2" href="#email-thread">
        View full email thread
      </a>
      <FullEmailThread
        entries={thread}
        error={threadError}
        replyDraftControls={replyDraftControls}
        noteOrganisationId={noteOrganisationId}
      />

      {/* AC3's filter: one control, five states, no page reload. Buttons with
          aria-pressed rather than a <select> — four options fit in a row and
          stay visible, which is the point of scanning at a glance. */}
      <div role="group" aria-label="Filter emails by status" className="mt-5 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((option) => {
          const active = option === filter;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(option)}
              className={`rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${
                active
                  ? "bg-brand text-white"
                  : "bg-black/5 text-foreground/60 hover:bg-black/10 hover:text-foreground/80"
              }`}
            >
              {describeStatusFilter(option)}
            </button>
          );
        })}
      </div>

      {nothingMatches && (
        <p className="mt-4 text-sm text-foreground/65">
          No emails with status {describeStatusFilter(filter)} for this client.
        </p>
      )}

      {(filtered.sent.length > 0 || filter === "all") && (
        <>
          <h3 className="mt-6 text-xs font-bold uppercase tracking-wide text-foreground/60">
            Sent
          </h3>
          {filtered.sent.length === 0 ? (
            <p className="mt-2 text-sm text-foreground/65">
              No emails have been sent to this client yet.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-black/5">
              {filtered.sent.map((message) => (
                <li key={message.id}>
                  <details className="py-2">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{message.subject}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-foreground/60">
                          {message.sent_at ? formatDate(message.sent_at) : ""}
                        </span>
                        {/* F130 AC1: every email carries its status, including
                            delivered ones — the group heading alone made "sent"
                            inferable rather than shown. */}
                        <StatusBadge status={message.send_status} />
                      </span>
                    </summary>
                    <EmailBodyPreview body={message.body} />
                    {/* F125: the exact final content plus who delivered it — sent
                        rows are immutable history, so attribution is fixed at send
                        time and falls back for senders since removed from users. */}
                    <p className="mt-2 text-xs text-foreground/55">
                      Sent by{" "}
                      {message.sender?.full_name?.trim() || "a former team member"}
                      {message.sent_at ? ` on ${formatDate(message.sent_at)}` : ""}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {(filtered.notSent.length > 0 || (filter === "all")) && (
        <>
          <h3 className="mt-6 text-xs font-bold uppercase tracking-wide text-foreground/60">
            Not sent
          </h3>
          {filtered.notSent.length === 0 ? (
            <p className="mt-2 text-sm text-foreground/65">Nothing waiting to be sent.</p>
          ) : (
            <ul className="mt-2 divide-y divide-black/5">
              {filtered.notSent.map((message) => (
                <li key={message.id}>
                  <details className="py-2">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{message.subject}</span>
                      {/* AC2's "send date", for something that has not gone out
                          yet: a scheduled row shows when it is due, so a CAM can
                          tell two hours from two weeks. Drafts and failures have
                          no due date — the badge carries the state instead. */}
                      <span className="flex shrink-0 items-center gap-2">
                        {message.scheduled_at && (
                          <span className="text-foreground/60">
                            Due {formatDate(message.scheduled_at)}
                          </span>
                        )}
                        <StatusBadge status={message.send_status} />
                      </span>
                    </summary>
                    <EmailBodyPreview body={message.body} />
                  </details>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
