"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, FileEdit, History, Loader2, X } from "lucide-react";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Pill } from "@/app/(app)/clients/[id]/section-card";
import {
  restrictedFieldLabel,
  type EditSuggestionRow,
} from "@/lib/edit-suggestions";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { decideEditSuggestionAction } from "./actions";

type ApprovalTab = "pending" | "history";
type PillTone = "go" | "hold" | "stop" | "neutral";

const STATUS_LABEL: Record<EditSuggestionRow["status"], string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Replaced",
};

const STATUS_TONE: Record<EditSuggestionRow["status"], PillTone> = {
  pending: "hold",
  approved: "go",
  rejected: "stop",
  superseded: "neutral",
};

function personLabel(person: { full_name: string | null; email: string } | null) {
  if (!person) return "Unknown team member";
  return person.full_name ?? person.email;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function DisplayValue({ value }: { value: string | null }) {
  return value ? (
    <span>{value}</span>
  ) : (
    <span className="italic text-faint">Not provided</span>
  );
}

export function ApprovalsPanel({
  initialSuggestions,
  canDecide,
}: {
  initialSuggestions: EditSuggestionRow[];
  /**
   * Whether this reader may decide anything. False for leadership, who read the
   * queue and are offered no control in it — see `approval:manage` in
   * `src/lib/auth/permissions.ts`. The server refuses them either way; this is
   * so the page does not offer a button that can only fail.
   */
  canDecide: boolean;
}) {
  const [activeTab, setActiveTab] = useState<ApprovalTab>("pending");
  const [pending, setPending] = useState(() =>
    initialSuggestions.filter((row) => row.status === "pending"),
  );
  const [decided, setDecided] = useState(() =>
    initialSuggestions.filter((row) => row.status !== "pending"),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyDecision, setBusyDecision] = useState<{
    id: string;
    approve: boolean;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  async function handleDecision(row: EditSuggestionRow, approve: boolean) {
    setBusyDecision({ id: row.id, approve });
    setFeedback(null);
    const reasonText = reasons[row.id]?.trim() || undefined;

    try {
      const result = await decideEditSuggestionAction({
        suggestionId: row.id,
        approve,
        reason: reasonText,
      });

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        return;
      }

      setPending((current) => current.filter((item) => item.id !== row.id));

      const updatedRow: EditSuggestionRow = {
        ...row,
        status: approve ? "approved" : "rejected",
        decided_at: new Date().toISOString(),
        rejection_reason: reasonText ?? null,
      };
      setDecided((current) => [updatedRow, ...current]);

      const clientName = row.organisations?.legal_name ?? "the client";
      const fieldLabel = restrictedFieldLabel(row.field_name);
      setFeedback({
        type: "success",
        message: approve
          ? `${fieldLabel} for ${clientName} was approved and applied to the live record.`
          : `The suggested change for ${clientName} was rejected. The live record was not changed.`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "The decision could not be saved. Check your connection and try again.",
      });
    } finally {
      setBusyDecision(null);
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextTab: ApprovalTab | null = null;
    if (event.key === "ArrowLeft" || event.key === "Home") nextTab = "pending";
    if (event.key === "ArrowRight" || event.key === "End") nextTab = "history";
    if (!nextTab) return;

    event.preventDefault();
    setActiveTab(nextTab);
    document.getElementById(`approvals-tab-${nextTab}`)?.focus();
  }

  return (
    <div className="space-y-6">
      {!canDecide && (
        <div className="rounded-inset bg-paper px-4 py-3">
          <p className="text-[13px] leading-[1.55] text-dim">
            {VIEW_ONLY_CONTROL_NOTE}
          </p>
        </div>
      )}

      <div
        className="flex items-end gap-6 border-b border-rule"
        role="tablist"
        aria-label="Approval views"
      >
        <button
          type="button"
          id="approvals-tab-pending"
          onClick={() => setActiveTab("pending")}
          onKeyDown={handleTabKeyDown}
          tabIndex={activeTab === "pending" ? 0 : -1}
          className={`relative inline-flex cursor-pointer items-center gap-2 pb-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 ${
            activeTab === "pending"
              ? "text-lead after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-lead"
              : "text-dim hover:text-ink"
          }`}
          aria-controls="approvals-panel-pending"
          aria-selected={activeTab === "pending"}
          role="tab"
        >
          Awaiting review
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
              activeTab === "pending" ? "bg-lead-wash text-lead" : "bg-paper-sunk text-dim"
            }`}
          >
            {pending.length}
          </span>
        </button>

        <button
          type="button"
          id="approvals-tab-history"
          onClick={() => setActiveTab("history")}
          onKeyDown={handleTabKeyDown}
          tabIndex={activeTab === "history" ? 0 : -1}
          className={`relative inline-flex cursor-pointer items-center gap-2 pb-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 ${
            activeTab === "history"
              ? "text-lead after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-lead"
              : "text-dim hover:text-ink"
          }`}
          aria-controls="approvals-panel-history"
          aria-selected={activeTab === "history"}
          role="tab"
        >
          Decision history
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
              activeTab === "history" ? "bg-lead-wash text-lead" : "bg-paper-sunk text-dim"
            }`}
          >
            {decided.length}
          </span>
        </button>
      </div>

      {feedback && (
        <div aria-live="polite">
          {feedback.type === "error" ? (
            <InlineAlert
              variant="page"
              className="rounded-panel border-stop/20 bg-stop-wash/60 text-stop"
              message={feedback.message}
            />
          ) : (
            <p
              role="status"
              className="flex items-start gap-2 rounded-inset bg-go-wash px-4 py-3 text-sm font-medium text-go"
            >
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{feedback.message}</span>
            </p>
          )}
        </div>
      )}

      <section
        id="approvals-panel-pending"
        role="tabpanel"
        aria-labelledby="approvals-tab-pending"
        hidden={activeTab !== "pending"}
      >
        {pending.length === 0 ? (
          <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-12 text-center">
            <Check className="mx-auto size-6 text-go" aria-hidden="true" />
            <h2 className="mt-3 font-body text-[18px] font-semibold tracking-[-0.01em] text-ink">
              Nothing is waiting for review
            </h2>
            <p className="mt-1 text-[13px] leading-[1.55] text-dim">
              New client-record changes will appear here when a CAM sends one for approval.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {pending.map((row) => {
              const isBusy = busyDecision?.id === row.id;
              const approving = isBusy && busyDecision.approve;
              const rejecting = isBusy && !busyDecision.approve;
              const fieldLabel = restrictedFieldLabel(row.field_name);
              const clientName = row.organisations?.legal_name ?? "Unknown client";
              const headingId = `suggestion-${row.id}`;

              return (
                <li key={row.id}>
                  <article
                    aria-labelledby={headingId}
                    className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6"
                  >
                    <header className="border-b border-rule-soft pb-4">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <h2
                            id={headingId}
                            className="font-body text-[20px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink"
                          >
                            <Link
                              href={`/clients/${row.organisation_id}`}
                              className="transition-colors hover:text-lead hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                            >
                              {clientName}
                            </Link>
                          </h2>
                          <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                            Proposed by {personLabel(row.requested_by_user)} on{" "}
                            {formatDateTime(row.created_at)}
                          </p>
                        </div>
                        <Pill tone="hold">Pending review</Pill>
                      </div>
                    </header>

                    <div className="mt-4 flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                      <FileEdit className="size-[15px] text-faint" aria-hidden="true" />
                      Proposed change: {fieldLabel}
                    </div>

                    <dl className="mt-3 grid overflow-hidden rounded-inset border border-rule-soft bg-paper sm:grid-cols-2">
                      <div className="p-4">
                        <dt className="text-[12.5px] font-medium text-dim">Current live value</dt>
                        <dd className="mt-1 break-words text-sm font-medium leading-[1.55] text-ink">
                          <DisplayValue value={row.current_value} />
                        </dd>
                      </div>
                      <div className="border-t border-rule-soft bg-lead-wash/55 p-4 sm:border-t-0 sm:border-l">
                        <dt className="text-[12.5px] font-medium text-lead">Proposed value</dt>
                        <dd className="mt-1 break-words text-sm font-semibold leading-[1.55] text-ink">
                          {row.proposed_value}
                        </dd>
                      </div>
                    </dl>

                    {canDecide && (
                      <div className="mt-4 border-t border-rule-soft pt-4">
                        <label
                          htmlFor={`reason-${row.id}`}
                          className="block text-[13px] font-semibold text-ink"
                        >
                          Reason for rejecting <span className="font-normal text-dim">(optional)</span>
                        </label>
                        <p className="mt-0.5 text-[12.5px] leading-[1.5] text-dim">
                          Add context for the CAM if you do not approve this change.
                        </p>
                        <textarea
                          id={`reason-${row.id}`}
                          disabled={isBusy}
                          rows={2}
                          value={reasons[row.id] ?? ""}
                          onChange={(event) =>
                            setReasons((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                          placeholder="For example, the public register shows a different address."
                          className="mt-2 w-full resize-y rounded-inset border border-rule bg-white px-3 py-2 text-sm leading-[1.55] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 disabled:opacity-60"
                        />

                        <div className="mt-3 flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDecision(row, true)}
                            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-inset border border-ink bg-ink px-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50"
                          >
                            {approving ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="size-3.5" aria-hidden="true" />
                            )}
                            {approving ? "Applying change" : "Approve and apply"}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDecision(row, false)}
                            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-inset border border-rule bg-white px-3.5 text-[13px] font-semibold text-stop transition-colors hover:border-stop/40 hover:bg-stop-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stop/25 disabled:pointer-events-none disabled:opacity-50"
                          >
                            {rejecting ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <X className="size-3.5" aria-hidden="true" />
                            )}
                            {rejecting ? "Saving decision" : "Reject"}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        id="approvals-panel-history"
        role="tabpanel"
        aria-labelledby="approvals-tab-history"
        hidden={activeTab !== "history"}
      >
        {decided.length === 0 ? (
          <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-12 text-center">
            <History className="mx-auto size-6 text-faint" aria-hidden="true" />
            <h2 className="mt-3 font-body text-[18px] font-semibold tracking-[-0.01em] text-ink">
              No decisions have been recorded
            </h2>
            <p className="mt-1 text-[13px] leading-[1.55] text-dim">
              Approved and rejected changes will stay here as a readable audit trail.
            </p>
          </div>
        ) : (
          <section
            aria-labelledby="decision-history-heading"
            className="overflow-hidden rounded-panel border border-rule bg-white"
          >
            <div className="px-5 py-4 sm:px-6">
              <h2
                id="decision-history-heading"
                className="font-body text-[18px] font-semibold tracking-[-0.01em] text-ink"
              >
                Recorded decisions
              </h2>
              <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                What was proposed, what happened, and who made the decision.
              </p>
            </div>
            <ul className="divide-y divide-rule-soft border-t border-rule-soft">
              {decided.map((row) => {
                const fieldLabel = restrictedFieldLabel(row.field_name);
                const clientName = row.organisations?.legal_name ?? "Unknown client";
                const approved = row.status === "approved";
                const rejected = row.status === "rejected";

                return (
                  <li key={row.id} className="px-5 py-5 sm:px-6">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <h3 className="font-body text-[16px] font-semibold leading-[1.35] text-ink">
                          <Link
                            href={`/clients/${row.organisation_id}`}
                            className="transition-colors hover:text-lead hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                          >
                            {clientName}
                          </Link>
                        </h3>
                        <p className="mt-0.5 text-[13px] text-dim">
                          Proposed change: {fieldLabel}
                        </p>
                      </div>
                      <Pill tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Pill>
                    </div>

                    <dl className="mt-3 grid items-stretch overflow-hidden rounded-inset bg-paper sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                      <div className="p-3.5">
                        <dt className="text-[12px] font-medium text-dim">
                          {approved ? "Previous value" : "Live value kept"}
                        </dt>
                        <dd className="mt-1 break-words text-[13.5px] font-medium leading-[1.5] text-ink">
                          <DisplayValue value={row.current_value} />
                        </dd>
                      </div>
                      <div className="hidden items-center border-x border-rule-soft px-3 text-faint sm:flex">
                        {approved ? (
                          <ArrowRight className="size-4" aria-hidden="true" />
                        ) : rejected ? (
                          <X className="size-4 text-stop" aria-hidden="true" />
                        ) : (
                          <History className="size-4" aria-hidden="true" />
                        )}
                      </div>
                      <div
                        className={`border-t border-rule-soft p-3.5 sm:border-t-0 ${
                          approved
                            ? "bg-go-wash/50"
                            : rejected
                              ? "bg-stop-wash/45"
                              : "bg-paper-sunk/60"
                        }`}
                      >
                        <dt
                          className={`text-[12px] font-medium ${
                            approved ? "text-go" : rejected ? "text-stop" : "text-dim"
                          }`}
                        >
                          {approved
                            ? "Applied value"
                            : rejected
                              ? "Suggested value not applied"
                              : "Earlier suggested value"}
                        </dt>
                        <dd className="mt-1 break-words text-[13.5px] font-semibold leading-[1.5] text-ink">
                          {row.proposed_value}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] leading-[1.5] text-dim">
                      <span>Proposed by {personLabel(row.requested_by_user)}</span>
                      {row.decided_at && (
                        <span>
                          Decided {formatDateTime(row.decided_at)}
                          {row.decided_by_user && (
                            <> by {personLabel(row.decided_by_user)}</>
                          )}
                        </span>
                      )}
                    </div>

                    {row.rejection_reason && (
                      <div className="mt-3 rounded-inset bg-paper px-3.5 py-2.5">
                        <p className="text-[12px] font-semibold text-ink">Reason given</p>
                        <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">
                          {row.rejection_reason}
                        </p>
                      </div>
                    )}

                    <Link
                      href={`/clients/${row.organisation_id}`}
                      className="mt-3 inline-flex text-[13px] font-semibold text-lead transition-colors hover:text-lead-mid hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                    >
                      {canDecide && approved
                        ? "Review or correct client record"
                        : "Open client record"}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </section>
    </div>
  );
}
