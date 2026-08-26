"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, FileEdit, History, X } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  restrictedFieldLabel,
  type EditSuggestionRow,
} from "@/lib/edit-suggestions";
import { decideEditSuggestionAction } from "./actions";

function personLabel(person: { full_name: string | null; email: string } | null) {
  if (!person) return "—";
  return person.full_name ?? person.email;
}

const STATUS_PILL: Record<EditSuggestionRow["status"], string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-900",
  rejected: "border-neutral-200 bg-neutral-100 text-foreground/65",
  superseded: "border-neutral-200 bg-neutral-100 text-foreground/45",
};

export function ApprovalsPanel({
  initialSuggestions,
}: {
  initialSuggestions: EditSuggestionRow[];
}) {
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [pending, setPending] = useState(() =>
    initialSuggestions.filter((row) => row.status === "pending"),
  );
  const [decided, setDecided] = useState(() =>
    initialSuggestions.filter((row) => row.status !== "pending"),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  async function handleDecision(row: EditSuggestionRow, approve: boolean) {
    setBusyId(row.id);
    setFeedback(null);
    const reasonText = reasons[row.id]?.trim() || undefined;

    try {
      const result = await decideEditSuggestionAction({
        suggestionId: row.id,
        approve,
        reason: reasonText,
      });

      if (!result.ok) {
        setFeedback({
          type: "error",
          message: result.error,
        });
        return;
      }

      // AC3: Genuinely pending items only — item moves out of pending view immediately
      setPending((prev) => prev.filter((item) => item.id !== row.id));

      const updatedRow: EditSuggestionRow = {
        ...row,
        status: approve ? "approved" : "rejected",
        decided_at: new Date().toISOString(),
        rejection_reason: reasonText ?? null,
      };
      setDecided((prev) => [updatedRow, ...prev]);

      const clientName = row.organisations?.legal_name ?? "client";
      const fieldLabel = restrictedFieldLabel(row.field_name);
      setFeedback({
        type: "success",
        message: approve
          ? `Approved correction to ${fieldLabel} for ${clientName}. Live record updated.`
          : `Rejected edit suggestion for ${clientName}. Live record unchanged.`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Could not reach the server. Please check your connection and try again.",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      {/* Subtitle / Context description */}
      <p className="text-sm leading-relaxed text-foreground/65">
        Review proposals from Client Account Managers. Approving applies the suggested
        value directly to the live client record and audits the change; rejecting leaves
        the record intact.
      </p>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-black/10 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("pending")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
            activeTab === "pending"
              ? "bg-black text-white"
              : "text-foreground/70 hover:bg-black/5 hover:text-foreground"
          }`}
          aria-selected={activeTab === "pending"}
          role="tab"
        >
          <span>Pending review</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              activeTab === "pending"
                ? "bg-white/20 text-white"
                : "bg-black/10 text-foreground/75"
            }`}
          >
            {pending.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
            activeTab === "history"
              ? "bg-black text-white"
              : "text-foreground/70 hover:bg-black/5 hover:text-foreground"
          }`}
          aria-selected={activeTab === "history"}
          role="tab"
        >
          <History className="h-4 w-4" aria-hidden="true" />
          <span>Decided history</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              activeTab === "history"
                ? "bg-white/20 text-white"
                : "bg-black/10 text-foreground/75"
            }`}
          >
            {decided.length}
          </span>
        </button>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div role="status" aria-live="polite">
          {feedback.type === "error" ? (
            <InlineAlert variant="page" message={feedback.message} />
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
              <Check className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>{feedback.message}</span>
            </div>
          )}
        </div>
      )}

      {/* Tab: Pending Items */}
      {activeTab === "pending" && (
        <section aria-label="Pending Approvals">
          {pending.length === 0 ? (
            <div className="rounded-2xl border border-black/10 bg-neutral-50/50 px-6 py-12 text-center">
              <Check className="mx-auto h-8 w-8 text-emerald-600" aria-hidden="true" />
              <h2 className="mt-3 text-base font-bold text-foreground">
                No pending approvals
              </h2>
              <p className="mt-1 text-sm text-foreground/60">
                All suggested client edits have been reviewed and decided.
              </p>
            </div>
          ) : (
            <ul className="space-y-5">
              {pending.map((row) => {
                const isBusy = busyId === row.id;
                const fieldLabel = restrictedFieldLabel(row.field_name);
                const clientName = row.organisations?.legal_name ?? "Unknown client";

                return (
                  <li
                    key={row.id}
                    className="rounded-2xl border border-black/10 bg-white p-5 shadow-xs transition-shadow hover:shadow-sm"
                  >
                    {/* Header: AC2 Item type badge and status badge */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/8 pb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* AC2: Distinguishable item type label */}
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-900">
                          <FileEdit className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
                          Client Edit Suggestion
                        </span>
                        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-foreground/75">
                          Field: {fieldLabel}
                        </span>
                      </div>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900">
                        Pending review
                      </span>
                    </div>

                    {/* Client & Content */}
                    <div className="mt-4">
                      <h3 className="text-lg font-bold text-foreground">
                        <Link
                          href={`/clients/${row.organisation_id}`}
                          className="hover:text-brand hover:underline"
                        >
                          {clientName}
                        </Link>
                      </h3>
                      <p className="mt-0.5 text-xs text-foreground/55">
                        Proposed by {personLabel(row.requested_by_user)} on{" "}
                        {new Date(row.created_at).toLocaleString("en-GB", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>

                    {/* Value comparison diff */}
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-black/8 bg-neutral-50 p-3">
                        <p className="text-xs font-semibold text-foreground/60">
                          Current live value
                        </p>
                        <p className="mt-1 text-sm font-medium text-foreground break-words">
                          {row.current_value ? (
                            <span>{row.current_value}</span>
                          ) : (
                            <span className="italic text-foreground/45">Not provided</span>
                          )}
                        </p>
                      </div>
                      <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-3">
                        <p className="text-xs font-semibold text-emerald-800">
                          Proposed new value
                        </p>
                        <p className="mt-1 text-sm font-semibold text-emerald-950 break-words">
                          {row.proposed_value}
                        </p>
                      </div>
                    </div>

                    {/* Optional Rejection Reason */}
                    <div className="mt-4">
                      <label
                        htmlFor={`reason-${row.id}`}
                        className="block text-xs font-semibold text-foreground/70"
                      >
                        Rejection reason (optional — visible to proposing CAM if rejected)
                      </label>
                      <textarea
                        id={`reason-${row.id}`}
                        disabled={isBusy}
                        rows={2}
                        value={reasons[row.id] ?? ""}
                        onChange={(e) =>
                          setReasons((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                        placeholder="e.g. Registered address confirmed via Companies House does not match."
                        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm placeholder:text-foreground/40 focus:border-brand focus:outline-none"
                      />
                    </div>

                    {/* Action buttons */}
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <OriginButton
                        size="sm"
                        variant="default"
                        disabled={isBusy}
                        loading={isBusy}
                        onClick={() => void handleDecision(row, true)}
                        type="button"
                      >
                        <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Approve and apply
                      </OriginButton>
                      <OriginButton
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => void handleDecision(row, false)}
                        type="button"
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Reject
                      </OriginButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Tab: Decided History */}
      {activeTab === "history" && (
        <section aria-label="Decided Approvals History">
          {decided.length === 0 ? (
            <div className="rounded-2xl border border-black/10 bg-neutral-50/50 px-6 py-12 text-center">
              <History className="mx-auto h-8 w-8 text-foreground/40" aria-hidden="true" />
              <h2 className="mt-3 text-base font-bold text-foreground">
                No decisions recorded yet
              </h2>
              <p className="mt-1 text-sm text-foreground/60">
                Decided edit suggestions will appear here for audit reference.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {decided.map((row) => {
                const fieldLabel = restrictedFieldLabel(row.field_name);
                const clientName = row.organisations?.legal_name ?? "Unknown client";

                return (
                  <li
                    key={row.id}
                    className="rounded-2xl border border-black/10 bg-white p-4 shadow-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/clients/${row.organisation_id}`}
                          className="font-bold text-foreground hover:text-brand hover:underline"
                        >
                          {clientName}
                        </Link>
                        <span className="text-xs text-foreground/50">•</span>
                        <span className="text-xs font-semibold text-foreground/75">
                          {fieldLabel}
                        </span>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-bold capitalize ${
                          STATUS_PILL[row.status]
                        }`}
                      >
                        {row.status}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-foreground/75">
                      <span className="text-foreground/55 line-through">
                        {row.current_value || "Not provided"}
                      </span>{" "}
                      →{" "}
                      <span className="font-semibold text-foreground">
                        {row.proposed_value}
                      </span>
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-foreground/50">
                      <span>Proposed by {personLabel(row.requested_by_user)}</span>
                      {row.decided_at && (
                        <span>
                          Decided on{" "}
                          {new Date(row.decided_at).toLocaleString("en-GB", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                          {row.decided_by_user && (
                            <> by {personLabel(row.decided_by_user)}</>
                          )}
                        </span>
                      )}
                    </div>

                    {row.rejection_reason && (
                      <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-1.5 text-xs text-foreground/75">
                        <strong className="font-semibold text-foreground/85">Reason:</strong>{" "}
                        {row.rejection_reason}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
