"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { DiscrepancyChoice, FieldDiscrepancyRow } from "@/lib/discrepancies";
import { discrepancyFieldLabel } from "@/lib/discrepancies";
import { SOURCE_LABELS } from "@/lib/source-tracking";
import { NETWORK_ERROR_MESSAGE } from "@/lib/network-error";
import { reportError } from "@/lib/error-logging";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { Key, Pill, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import {
  PageSizeSelect,
  PagingSummary,
  useListPager,
} from "@/components/ui/list-pager";
import { resolveDiscrepancyAction } from "./actions";

/**
 * 5 / 10 / 15 / 20 rather than the shared 25/50: this list is a reading list
 * (who decided what, and why), not a table to scan — and nothing ever leaves it,
 * so the smallest useful page keeps the whole history navigable rather than
 * lazy-loading a wall of settled decisions.
 */
const HISTORY_PAGE_SIZES = [5, 10, 15, 20];

const PRIMARY_BUTTON =
  "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-inset border border-lead bg-lead px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const SECONDARY_BUTTON =
  "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-inset border border-rule bg-white px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-lead/40 hover:bg-lead-wash focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

function personLabel(person: { full_name: string | null; email: string } | null): string {
  if (!person) return "A former team member";
  return person.full_name?.trim() || person.email;
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? "Another source";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayValue(value: string | null): string {
  return value?.trim() || "No value recorded";
}

function resolvedSource(row: FieldDiscrepancyRow): string {
  if (row.resolved_choice === "existing") return sourceLabel(row.existing_source);
  if (row.resolved_choice === "incoming") return sourceLabel(row.incoming_source);
  return "the selected source";
}

function ClientName({ row, linked = false }: { row: FieldDiscrepancyRow; linked?: boolean }) {
  const name = row.organisation?.legal_name?.trim() || "Unnamed client";
  if (!linked) return <>{name}</>;
  return (
    <Link
      href={`/clients/${row.organisation_id}`}
      className="rounded-sm text-lead underline decoration-lead/25 underline-offset-3 transition-colors hover:decoration-lead focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
    >
      {name}
    </Link>
  );
}

function ComparisonValue({
  label,
  source,
  value,
}: {
  label: string;
  source: string;
  value: string;
}) {
  return (
    <div className="flex min-h-32 flex-col rounded-inset bg-paper px-4 py-3.5">
      <p className="text-[13px] font-medium text-dim">{label}</p>
      <p className="mt-2 flex-1 text-[15px] leading-[1.55] font-semibold break-words text-ink">
        {displayValue(value)}
      </p>
      <div className="mt-3 border-t border-rule-soft pt-2.5">
        <Key>{sourceLabel(source)}</Key>
      </div>
    </div>
  );
}

export function DiscrepanciesPanel({
  initialDiscrepancies,
  canDecide,
}: {
  initialDiscrepancies: FieldDiscrepancyRow[];
  /**
   * Whether this reader may answer a discrepancy. False for leadership, who see
   * the full queue and history but no controls the write would refuse.
   */
  canDecide: boolean;
}) {
  const [rows, setRows] = useState(initialDiscrepancies);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function resolve(fieldDiscrepancyId: string, choice: DiscrepancyChoice) {
    setBusyId(fieldDiscrepancyId);
    setStatus(null);
    try {
      const result = await resolveDiscrepancyAction({
        fieldDiscrepancyId,
        choice,
        note: notes[fieldDiscrepancyId] ?? "",
      });
      if (!result.ok) {
        setStatus({ text: result.error, tone: "error" });
        return;
      }

      if (!result.discrepancies) {
        setStatus({
          text: "The decision was saved, but the list could not be refreshed. Refresh the page to see the latest queue.",
          tone: "error",
        });
        return;
      }

      setRows(result.discrepancies);
      setNotes((current) => {
        const next = { ...current };
        delete next[fieldDiscrepancyId];
        return next;
      });
      setStatus({
        text:
          choice === "existing"
            ? "Kept the value already on the client record."
            : "Updated the client record with the incoming value.",
        tone: "success",
      });
    } catch (err) {
      void reportError(err, { operation: "admin.discrepancies.resolve_client" });
      setStatus({ text: NETWORK_ERROR_MESSAGE, tone: "error" });
    } finally {
      setBusyId(null);
    }
  }

  const pending = rows.filter((row) => row.status === "pending");
  const resolved = rows.filter((row) => row.status !== "pending");
  const isBusy = busyId !== null;
  /**
   * The history is paged from the top, and it is the one list here that has to
   * be: every settled disagreement stays in it, so it is the only list on the
   * page guaranteed to grow. Nothing moves between pages except when a decision
   * is answered, which puts a row at the front — where the reader already is.
   */
  const historyPager = useListPager(resolved, 10, HISTORY_PAGE_SIZES);

  return (
    <div className="space-y-8">
      <div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${pending.length > 0 ? "bg-hold" : "bg-go"}`}
          />
          <span>
            <span className="font-semibold text-ink">
              {pending.length === 0
                ? "Nothing waiting for review"
                : `${pending.length} ${pending.length === 1 ? "decision" : "decisions"} waiting`}
            </span>
            {resolved.length > 0 && (
              <>
                {" · "}
                {resolved.length} {resolved.length === 1 ? "decision" : "decisions"} recorded
              </>
            )}
          </span>
        </p>
        {!canDecide && pending.length > 0 && (
          <p className="mt-2 text-sm text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
        )}
      </div>

      {status && (
        <p
          aria-live="polite"
          role={status.tone === "error" ? "alert" : "status"}
          className={`rounded-panel border px-4 py-3 text-[13px] font-semibold ${
            status.tone === "error"
              ? "border-stop/30 bg-stop-wash text-stop"
              : "border-go/30 bg-go-wash text-go"
          }`}
        >
          {status.text}
        </p>
      )}

      <section aria-labelledby="waiting-heading">
        <div className="mb-4">
          <h2
            id="waiting-heading"
            className="font-body text-[19px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
          >
            Waiting for review
          </h2>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
            Compare what is already on the client record with the value found by the latest source.
          </p>
        </div>

        {pending.length === 0 ? (
          <SectionCard
            headingId="empty-discrepancies-heading"
            title="Every disagreement has been settled"
            hint="New disagreements will appear here before either value replaces the other."
            action={<Pill tone="go">Up to date</Pill>}
          />
        ) : (
          <ul className="space-y-4">
            {pending.map((row) => {
              const headingId = `discrepancy-${row.id}`;
              const noteId = `note-${row.id}`;
              const isThisBusy = busyId === row.id;

              return (
                <li key={row.id}>
                  <SectionCard
                    headingId={headingId}
                    title={discrepancyFieldLabel(row.field_name)}
                    hint={
                      <>
                        <ClientName row={row} linked />
                        {" · Flagged "}
                        {formatDate(row.created_at)}
                      </>
                    }
                    action={<Pill tone="hold">Needs a decision</Pill>}
                  >
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <ComparisonValue
                        label="Already on the client record"
                        source={row.existing_source}
                        value={row.existing_value}
                      />
                      <ComparisonValue
                        label="Found in the incoming record"
                        source={row.incoming_source}
                        value={row.incoming_value}
                      />
                    </div>

                    {canDecide && (
                      <div className="mt-4 border-t border-rule-soft pt-4">
                        <div>
                          <label className="text-[13px] font-medium text-ink" htmlFor={noteId}>
                            Reason for this decision{" "}
                            <span className="font-normal text-faint">(optional)</span>
                          </label>
                          <p className="mt-0.5 text-[12px] leading-[1.5] text-dim">
                            This note stays with the decision in the history below.
                          </p>
                        </div>
                        <textarea
                          className="mt-2 min-h-20 w-full resize-y rounded-inset border border-rule bg-white px-3 py-2 text-sm leading-[1.55] text-ink outline-none placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 disabled:bg-paper disabled:opacity-70"
                          disabled={isBusy}
                          id={noteId}
                          onChange={(event) =>
                            setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                          placeholder="Add context for the next person who reads this decision"
                          rows={2}
                          value={notes[row.id] ?? ""}
                        />
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <button
                            className={SECONDARY_BUTTON}
                            disabled={isBusy}
                            onClick={() => resolve(row.id, "existing")}
                            type="button"
                          >
                            {isThisBusy && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
                            Keep the current value
                          </button>
                          <button
                            className={PRIMARY_BUTTON}
                            disabled={isBusy}
                            onClick={() => resolve(row.id, "incoming")}
                            type="button"
                          >
                            {isThisBusy && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
                            Use the incoming value
                          </button>
                        </div>
                      </div>
                    )}
                  </SectionCard>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SectionCard
        headingId="decision-history-heading"
        title="Decision history"
        hint="Every settled disagreement stays here, including who decided it and any reason they left."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {resolved.length > 0 && <Pill dot={false}>{resolved.length.toLocaleString()}</Pill>}
            {historyPager.showPager && (
              <PageSizeSelect
                pageSize={historyPager.pageSize}
                onChange={historyPager.setPageSize}
                pageSizeOptions={HISTORY_PAGE_SIZES}
              />
            )}
          </div>
        }
      >
        {resolved.length === 0 ? (
          <p className="mt-4 border-t border-rule-soft pt-4 text-[13px] leading-[1.55] text-dim">
            No decisions have been recorded yet.
          </p>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              {/* The count and the chevrons sit above the rows: the count is how
                  the reader knows the history is longer than the page they are
                  on, and a footer is a control they have to scroll to reach. */}
              {historyPager.showPager && (
                <PagingSummary summary={historyPager} onPageChange={historyPager.setPage} />
              )}
              <ul className="divide-y divide-rule-soft border-t border-rule-soft">
                {historyPager.items.map((row) => (
                  <li key={row.id} className="py-4 first:pt-4 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">
                          <ClientName row={row} linked />
                        </p>
                        <p className="mt-0.5 text-[13px] text-dim">
                          {discrepancyFieldLabel(row.field_name)} · Kept the value from {resolvedSource(row)}
                        </p>
                      </div>
                      <p className="shrink-0 text-[12px] text-faint">
                        {formatDate(row.resolved_at ?? row.created_at)}
                      </p>
                    </div>
                    <div className="mt-3 rounded-inset bg-paper px-3.5 py-3">
                      <p className="text-sm leading-[1.55] font-medium break-words text-ink">
                        {displayValue(row.resolved_value)}
                      </p>
                    </div>
                    <p className="mt-2 text-[12px] leading-[1.5] text-dim">
                      Decided by{" "}
                      <span className="font-medium text-ink">{personLabel(row.resolved_by_user)}</span>
                      {row.notes?.trim() && <span> · “{row.notes.trim()}”</span>}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}
