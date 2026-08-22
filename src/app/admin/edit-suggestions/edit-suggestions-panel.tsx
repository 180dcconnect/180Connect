"use client";

import { useState } from "react";
import Link from "next/link";
import { OriginButton } from "@/components/ui/origin-button";
import {
  describePendingSuggestion,
  SENSITIVE_FIELD_LABELS,
  type EditSuggestionRow,
  isSensitiveOrgField,
} from "@/lib/edit-suggestions";

const STATUS_STYLE: Record<EditSuggestionRow["status"], string> = {
  pending: "bg-amber-50 text-amber-800",
  approved: "bg-green-50 text-green-800",
  rejected: "bg-black/5 text-foreground/65",
  superseded: "bg-black/5 text-foreground/45",
};

function personLabel(person: { full_name: string | null; email: string } | null) {
  if (!person) return "—";
  return person.full_name ?? person.email;
}

function fieldLabel(fieldName: string): string {
  return isSensitiveOrgField(fieldName) ? SENSITIVE_FIELD_LABELS[fieldName] : fieldName;
}

/**
 * #80/#81 — pending suggestions with inline Approve/Reject, decided history below.
 * Same shape as ownership-requests-panel: local state over the initial rows, PATCH
 * to the admin route, refresh from its GET. The stale-value warning mirrors the
 * ownership panel's changed-hands warning — a proposal made against data that has
 * since moved cannot be approved blind (the RPC refuses it; saying so here saves
 * the admin a failed click).
 */
export function EditSuggestionsPanel({
  initialSuggestions,
}: {
  initialSuggestions: EditSuggestionRow[];
}) {
  const [rows, setRows] = useState(initialSuggestions);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function fieldLabelFor(row: EditSuggestionRow) {
    return fieldLabel(row.field_name);
  }

  async function refresh() {
    const response = await fetch("/api/admin/edit-suggestions");
    if (!response.ok) return;
    const body = await response.json();
    setRows(body.suggestions as EditSuggestionRow[]);
  }

  async function decide(suggestionId: string, approve: boolean) {
    setBusyId(suggestionId);
    setMessage("");
    try {
      const response = await fetch("/api/admin/edit-suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId,
          approve,
          reason: reasons[suggestionId] ?? "",
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "The decision could not be saved.");
        return;
      }
      setMessage(
        approve
          ? "Approved. The live client record now carries the proposed value."
          : "Rejected. The live record is unchanged.",
      );
      await refresh();
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = rows.filter((row) => row.status === "pending");
  const decided = rows.filter((row) => row.status !== "pending");

  return (
    <div className="mt-8 space-y-10">
      <p aria-live="polite" className="min-h-6 text-sm font-bold">
        {message}
      </p>

      <div>
        <h2 className="text-sm font-bold">Pending</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/55">
            Nothing is waiting for review.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {pending.map((row) => (
              <li key={row.id} className="rounded-xl border border-black/10 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link
                    href={`/clients/${row.organisation_id}`}
                    className="font-bold hover:text-brand hover:underline"
                  >
                    {row.organisations?.legal_name ?? "Unknown client"}
                  </Link>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
                    Pending
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground/75">
                  {describePendingSuggestion(
                    fieldLabelFor(row),
                    row.current_value,
                    row.proposed_value,
                  )}
                </p>
                <p className="mt-1 text-xs text-foreground/50">
                  {personLabel(row.requested_by_user)} proposed this on{" "}
                  {new Date(row.created_at).toLocaleString("en-GB")}
                </p>
                <label
                  className="mt-3 block text-sm font-bold"
                  htmlFor={`reason-${row.id}`}
                >
                  Reason (optional, shown to the CAM)
                </label>
                <textarea
                  className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2"
                  disabled={busyId === row.id}
                  id={`reason-${row.id}`}
                  onChange={(event) =>
                    setReasons((current) => ({ ...current, [row.id]: event.target.value }))
                  }
                  rows={2}
                  value={reasons[row.id] ?? ""}
                />
                <div className="mt-3 flex gap-3">
                  <OriginButton
                    size="sm"
                    disabled={busyId === row.id}
                    loading={busyId === row.id}
                    onClick={() => decide(row.id, true)}
                    type="button"
                  >
                    Approve and apply
                  </OriginButton>
                  <OriginButton
                    size="sm"
                    variant="outline"
                    disabled={busyId === row.id}
                    onClick={() => decide(row.id, false)}
                    type="button"
                  >
                    Reject
                  </OriginButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-sm font-bold">Decided</h2>
        {decided.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/55">Nothing decided yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {decided.map((row) => (
              <li key={row.id} className="rounded-xl border border-black/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/clients/${row.organisation_id}`}
                    className="font-bold hover:text-brand hover:underline"
                  >
                    {row.organisations?.legal_name ?? "Unknown client"}
                  </Link>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[row.status]}`}
                  >
                    {row.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground/75">
                  {describePendingSuggestion(
                    fieldLabelFor(row),
                    row.current_value,
                    row.proposed_value,
                  )}
                </p>
                <p className="mt-1 text-xs text-foreground/50">
                  {personLabel(row.requested_by_user)} asked;{" "}
                  {personLabel(row.decided_by_user)} decided
                  {row.decided_at
                    ? ` on ${new Date(row.decided_at).toLocaleString("en-GB")}`
                    : ""}
                </p>
                {row.rejection_reason && (
                  <p className="mt-1 text-xs text-foreground/65">
                    Reason: {row.rejection_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
