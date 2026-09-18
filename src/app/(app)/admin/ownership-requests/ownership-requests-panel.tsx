"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";

import { Pill, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import { PageSizeSelect, PagingSummary, useListPager } from "@/components/ui/list-pager";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { NETWORK_ERROR_MESSAGE } from "@/lib/network-error";
import type { OwnershipRequestRow, OwnershipRequestStatus } from "@/lib/ownership-requests";

type OwnershipTab = "queue" | "history";

const TABS: readonly { id: OwnershipTab; label: string }[] = [
  { id: "queue", label: "Waiting for a decision" },
  { id: "history", label: "Decision history" },
];

const TAB_ORDER: readonly OwnershipTab[] = ["queue", "history"];

/**
 * The four state tones, via Pill — never a ramp colour of our own. The tones
 * match the approvals queue's decision language: waiting is hold, approved is
 * go, declined is stop.
 */
const STATUS_TONE: Record<OwnershipRequestStatus, "go" | "hold" | "stop"> = {
  pending: "hold",
  approved: "go",
  rejected: "stop",
};

const STATUS_LABEL: Record<OwnershipRequestStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Declined",
};

const APPROVE_BUTTON =
  "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-inset border border-ink bg-ink px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const REJECT_BUTTON =
  "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-inset border border-rule bg-white px-3 py-1.5 text-[13px] font-semibold text-stop transition-colors hover:border-stop/40 hover:bg-stop-wash focus-visible:ring-2 focus-visible:ring-stop/25 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const NOTE_FIELD =
  "mt-2 w-full resize-y rounded-inset border border-rule bg-white px-3 py-2 text-sm leading-[1.55] text-ink outline-none placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 disabled:bg-paper disabled:opacity-70";

function personLabel(person: { full_name: string | null; email: string } | null): string {
  if (!person) return "A former team member";
  return person.full_name?.trim() || person.email;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The ask, on the card's paper inset — the same treatment as a suppression request's reason. */
function SavedReason({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-inset bg-paper px-3.5 py-3">
      <p className="text-[12px] font-medium text-dim">{label}</p>
      <p className="mt-1 text-sm leading-[1.55] break-words text-ink">{children}</p>
    </div>
  );
}

/**
 * The one reading that can go stale, surfaced where the decision is made.
 *
 * A request can sit pending for days, and the client may change hands in that
 * time — including to the requester, which the RPC treats as a no-op approval.
 * The queue cannot re-read ownership on its own, so this note is a caution, not
 * a block: it tells the admin to check before approving rather than pretending
 * the row knows. Amber (hold), not red — nothing is wrong yet, and a warning
 * that is always shouting is one nobody reads.
 */
function OwnershipMovedNote({ moved }: { moved: boolean }) {
  if (!moved) return null;
  return (
    <p className="mt-3 flex items-start gap-2 rounded-inset bg-hold-wash px-3 py-2.5 text-[13px] leading-[1.55] text-hold">
      <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-hold" />
      This client has changed hands since the request was made. Check who owns it
      now before approving — approving always hands it to the CAM who asked.
    </p>
  );
}

export function OwnershipRequestsPanel({
  initialPending,
  initialDecided,
  canDecide,
}: {
  initialPending: OwnershipRequestRow[];
  initialDecided: OwnershipRequestRow[];
  /**
   * Whether this reader may decide a request. False for leadership, who see
   * who asked for which client and give none of them away — the PATCH route
   * behind the two answers refuses them, so no button that can only refuse is
   * drawn. Every reading stays: the queue, the counts, the history.
   */
  canDecide: boolean;
}) {
  const [pending, setPending] = useState(initialPending);
  const [decided, setDecided] = useState(initialDecided);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OwnershipTab>("queue");

  const historyPager = useListPager(decided, 10);

  async function refresh() {
    const response = await fetch("/api/admin/ownership-requests");
    if (!response.ok) return;
    const body = await response.json();
    const rows = (body.requests ?? []) as OwnershipRequestRow[];
    setPending(rows.filter((row) => row.status === "pending"));
    setDecided(rows.filter((row) => row.status !== "pending"));
  }

  async function decide(row: OwnershipRequestRow, approve: boolean) {
    setBusyId(row.id);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/ownership-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: row.id,
          approve,
          note: notes[row.id]?.trim() || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage({ tone: "error", text: body.error ?? "The decision could not be saved." });
        return;
      }
      setMessage({
        tone: "success",
        text: approve
          ? `Approved. ${row.organisations?.legal_name ?? "The client"} now belongs to ${personLabel(row.requested_by_user)}.`
          : `Declined. ${row.organisations?.legal_name ?? "The client"} stays with ${personLabel(row.current_owner_user)}.`,
      });
      await refresh();
    } catch {
      setMessage({ tone: "error", text: NETWORK_ERROR_MESSAGE });
    } finally {
      setBusyId(null);
    }
  }

  function switchTab(tab: OwnershipTab) {
    setActiveTab(tab);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const at = TAB_ORDER.indexOf(activeTab);
    let nextTab: OwnershipTab | null = null;
    if (event.key === "ArrowRight")
      nextTab = TAB_ORDER[(at + 1) % TAB_ORDER.length] ?? null;
    if (event.key === "ArrowLeft")
      nextTab = TAB_ORDER[(at - 1 + TAB_ORDER.length) % TAB_ORDER.length] ?? null;
    if (event.key === "Home") nextTab = TAB_ORDER[0] ?? null;
    if (event.key === "End") nextTab = TAB_ORDER[TAB_ORDER.length - 1] ?? null;
    if (!nextTab) return;
    event.preventDefault();
    switchTab(nextTab);
    document.getElementById(`ownership-tab-${nextTab}`)?.focus();
  }

  return (
    <div className="space-y-6">
      {!canDecide && (
        <div className="rounded-inset bg-paper px-4 py-3">
          <p className="text-[13px] leading-[1.55] text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
        </div>
      )}

      {/* The tablist the approvals, suppressions and review queues share: two
          views, counts on each tab, arrow-key support. The queue is the
          landing view — an admin arrives to answer, not to read history. */}
      <div
        className="flex items-end gap-6 border-b border-rule"
        role="tablist"
        aria-label="Ownership request views"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = tab.id === "queue" ? pending.length : decided.length;
          return (
            <button
              key={tab.id}
              type="button"
              id={`ownership-tab-${tab.id}`}
              onClick={() => switchTab(tab.id)}
              onKeyDown={handleTabKeyDown}
              tabIndex={isActive ? 0 : -1}
              className={`relative inline-flex cursor-pointer items-center gap-2 pb-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none ${
                isActive
                  ? "text-lead after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-lead"
                  : "text-dim hover:text-ink"
              }`}
              aria-controls={`ownership-panel-${tab.id}`}
              aria-selected={isActive}
              role="tab"
            >
              {tab.label}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
                  isActive ? "bg-lead-wash text-lead" : "bg-paper-sunk text-dim"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {message && (
        <div aria-live="polite">
          {message.tone === "error" ? (
            <p
              role="alert"
              className="rounded-panel border border-stop/20 bg-stop-wash/60 px-5 py-4 text-sm font-semibold text-stop"
            >
              {message.text}
            </p>
          ) : (
            <p
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-inset bg-go-wash px-4 py-3 text-sm font-medium text-go"
            >
              <Check aria-hidden="true" className="size-4 shrink-0" />
              {message.text}
            </p>
          )}
        </div>
      )}

      {/* ── The queue ── */}
      <section
        id="ownership-panel-queue"
        role="tabpanel"
        aria-labelledby="ownership-tab-queue"
        hidden={activeTab !== "queue"}
      >
        {pending.length === 0 ? (
          <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-12 text-center">
            <Check className="mx-auto size-6 text-go" aria-hidden="true" />
            <h2 className="mt-3 font-body text-[18px] font-semibold tracking-[-0.01em] text-ink">
              No CAM is waiting on a client
            </h2>
            <p className="mt-1 text-[13px] leading-[1.55] text-dim">
              When a CAM asks to take over a client another CAM owns, the ask
              will appear here with their reason before anything moves.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {pending.map((row) => {
              const clientName = row.organisations?.legal_name ?? "Unknown client";
              const rowBusy = busyId === row.id;
              // The RPC refuses an already-decided request (55000), so a second
              // admin answering the same queue a moment later is told plainly
              // rather than left with a spinner.
              const alreadyDecided = row.status !== "pending";
              return (
                <li key={row.id}>
                  <SectionCard
                    headingId={`ownership-request-${row.id}`}
                    title={clientName}
                    hint={
                      <>
                        Requested by {personLabel(row.requested_by_user)} ·{" "}
                        {formatDateTime(row.created_at)}
                      </>
                    }
                    action={<Pill tone="hold">Waiting for a decision</Pill>}
                  >
                    <div className="mt-4">
                      <SavedReason label="Why they are asking">{row.reason}</SavedReason>
                      <p className="mt-2 text-[13px] leading-[1.55] text-dim">
                        Currently owned by{" "}
                        <span className="font-medium text-ink">
                          {personLabel(row.current_owner_user)}
                        </span>
                        .{" "}
                        <Link
                          href={`/clients/${row.organisation_id}`}
                          className="font-medium text-lead hover:underline"
                        >
                          Open the client record
                        </Link>
                      </p>

                      <OwnershipMovedNote
                        moved={
                          row.current_owner_id !== null &&
                          row.organisations?.owner_id !== undefined &&
                          row.current_owner_id !== row.organisations?.owner_id
                        }
                      />

                      {canDecide && (
                        <div className="mt-4 border-t border-rule-soft pt-4">
                          {alreadyDecided ? (
                            <p className="rounded-inset bg-paper px-3 py-2.5 text-[13px] text-dim">
                              Another administrator decided this request while
                              you were reading. Refresh the page to see the outcome.
                            </p>
                          ) : (
                            <>
                              <label
                                className="text-[13px] font-medium text-ink"
                                htmlFor={`decision-note-${row.id}`}
                              >
                                Decision note <span className="font-normal text-faint">(optional)</span>
                              </label>
                              <p className="mt-0.5 text-[12px] leading-[1.5] text-dim">
                                Kept with the approval or decline in the history tab.
                              </p>
                              <textarea
                                className={NOTE_FIELD}
                                disabled={rowBusy}
                                id={`decision-note-${row.id}`}
                                maxLength={2_000}
                                onChange={(event) =>
                                  setNotes((current) => ({
                                    ...current,
                                    [row.id]: event.target.value,
                                  }))
                                }
                                placeholder="Add context for the requester"
                                rows={2}
                                value={notes[row.id] ?? ""}
                              />
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <button
                                  className={APPROVE_BUTTON}
                                  disabled={rowBusy}
                                  onClick={() => void decide(row, true)}
                                  type="button"
                                >
                                  {rowBusy && (
                                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                                  )}
                                  Approve and move the client
                                </button>
                                <button
                                  className={REJECT_BUTTON}
                                  disabled={rowBusy}
                                  onClick={() => void decide(row, false)}
                                  type="button"
                                >
                                  {rowBusy && (
                                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                                  )}
                                  Keep it with its owner
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </SectionCard>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── The history ── */}
      <section
        id="ownership-panel-history"
        role="tabpanel"
        aria-labelledby="ownership-tab-history"
        hidden={activeTab !== "history"}
      >
        <p className="text-[13px] leading-[1.55] text-dim">
          Every decision made so far, who made it, and what happened to the
          client. Approvals and declines are also recorded in the audit log.
        </p>

        {decided.length === 0 ? (
          <div className="mt-4 rounded-panel border border-dashed border-rule bg-white px-6 py-12 text-center">
            <h2 className="font-body text-[18px] font-semibold tracking-[-0.01em] text-ink">
              Nothing decided yet
            </h2>
            <p className="mt-1 text-[13px] leading-[1.55] text-dim">
              Approvals and declines will appear here, with the note left for the
              requester.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {/* The count sits above the rows: this list only grows, and a pager
                without the count reads as though the page is all there is. */}
            {historyPager.showPager && (
              <PageSizeSelect
                pageSize={historyPager.pageSize}
                onChange={historyPager.setPageSize}
              />
            )}
            <PagingSummary summary={historyPager} onPageChange={historyPager.setPage} />
            <div className="overflow-hidden rounded-panel border border-rule bg-white">
              <ul className="divide-y divide-rule-soft">
                {historyPager.items.map((row) => {
                  const approved = row.status === "approved";
                  const clientName = row.organisations?.legal_name ?? "Unknown client";
                  return (
                    <li key={row.id} className="px-5 py-4 sm:px-6">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <h3 className="font-body text-[16px] font-semibold leading-[1.35] text-ink">
                            <Link
                              href={`/clients/${row.organisation_id}`}
                              className="transition-colors hover:text-lead hover:underline"
                            >
                              {clientName}
                            </Link>
                          </h3>
                          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-dim">
                            {personLabel(row.requested_by_user)} asked ·{" "}
                            {row.decided_by_user
                              ? `${personLabel(row.decided_by_user)} ${approved ? "approved" : "declined"}`
                              : "Decided"}
                            {row.decided_at ? ` on ${formatDateTime(row.decided_at)}` : ""}
                          </p>
                        </div>
                        <Pill tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Pill>
                      </div>
                      {row.decision_note && (
                        <p className="mt-2 text-[13px] leading-[1.55] text-dim">
                          <span className="font-medium text-ink">Note: </span>
                          {row.decision_note}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
