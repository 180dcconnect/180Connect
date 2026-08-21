"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import type { OwnershipRequestRow } from "@/lib/ownership-requests";

const STATUS_STYLE: Record<OwnershipRequestRow["status"], string> = {
  pending: "bg-amber-50 text-amber-800",
  approved: "bg-green-50 text-green-800",
  rejected: "bg-black/5 text-foreground/65",
};

function personLabel(person: { full_name: string | null; email: string } | null) {
  if (!person) return "—";
  return person.full_name ?? person.email;
}

export function OwnershipRequestsPanel({
  initialRequests,
}: {
  initialRequests: OwnershipRequestRow[];
}) {
  const [rows, setRows] = useState(initialRequests);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/admin/ownership-requests");
    if (!response.ok) return;
    const body = await response.json();
    setRows(body.requests as OwnershipRequestRow[]);
  }

  async function decide(requestId: string, approve: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/ownership-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, approve, note: notes[requestId] ?? "" }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "The decision could not be saved.");
        return;
      }
      setMessage(
        approve
          ? "Approved. The client has moved to the requesting CAM."
          : "Rejected. Ownership is unchanged.",
      );
      await refresh();
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
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
          <p className="mt-2 text-sm text-foreground/55">No CAM is waiting on a client.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {pending.map((row) => (
              <li key={row.id} className="rounded-xl border border-black/10 p-4">
                <p className="font-bold">{row.organisations?.legal_name ?? "Unknown client"}</p>
                <p className="mt-1 text-sm text-foreground/75">{row.reason}</p>
                <p className="mt-1 text-xs text-foreground/50">
                  {personLabel(row.requested_by_user)} is asking for this client, currently
                  owned by {personLabel(row.current_owner_user)} — requested{" "}
                  {new Date(row.created_at).toLocaleString("en-GB")}
                </p>
                {row.current_owner_id !== row.organisations?.owner_id && (
                  <p
                    className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800"
                    role="alert"
                  >
                    This client has changed hands since the request was made. Check who owns
                    it now before approving.
                  </p>
                )}
                <label className="mt-3 block text-sm font-bold" htmlFor={`note-${row.id}`}>
                  Note (optional)
                </label>
                <textarea
                  className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2"
                  disabled={busy}
                  id={`note-${row.id}`}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                  }
                  rows={2}
                  value={notes[row.id] ?? ""}
                />
                <div className="mt-3 flex gap-3">
                  <OriginButton
                    size="sm"
                    disabled={busy}
                    onClick={() => decide(row.id, true)}
                    type="button"
                  >
                    Approve and move the client
                  </OriginButton>
                  <OriginButton
                    size="sm"
                    variant="outline"
                    disabled={busy}
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
                  <p className="font-bold">{row.organisations?.legal_name ?? "Unknown client"}</p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[row.status]}`}
                  >
                    {row.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground/75">{row.reason}</p>
                <p className="mt-1 text-xs text-foreground/50">
                  {personLabel(row.requested_by_user)} asked; {personLabel(row.decided_by_user)}{" "}
                  decided
                  {row.decided_at ? ` on ${new Date(row.decided_at).toLocaleString("en-GB")}` : ""}
                </p>
                {row.decision_note && (
                  <p className="mt-1 text-xs text-foreground/65">Note: {row.decision_note}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
