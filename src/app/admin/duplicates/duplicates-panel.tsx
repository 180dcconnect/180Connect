"use client";

import { useState } from "react";
import type { PotentialDuplicateRow } from "@/lib/duplicates";

const STATUS_STYLE: Record<PotentialDuplicateRow["status"], string> = {
  pending: "bg-amber-50 text-amber-800",
  confirmed_duplicate: "bg-black/5 text-foreground/65",
  not_duplicate: "bg-green-50 text-green-800",
};

const MATCHED_ON_LABEL: Record<PotentialDuplicateRow["matched_on"], string> = {
  registration_number: "Registration number",
  name_and_postcode: "Name and postcode",
};

function personLabel(person: { full_name: string | null; email: string } | null) {
  if (!person) return "—";
  return person.full_name ?? person.email;
}

function incomingName(row: PotentialDuplicateRow) {
  return row.raw_source_record?.raw_payload.charity_name ?? "Unknown incoming record";
}

export function DuplicatesPanel({
  initialDuplicates,
}: {
  initialDuplicates: PotentialDuplicateRow[];
}) {
  const [rows, setRows] = useState(initialDuplicates);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/admin/duplicates");
    if (!response.ok) return;
    const body = await response.json();
    setRows(body.duplicates as PotentialDuplicateRow[]);
  }

  async function decide(potentialDuplicateId: string, confirmed: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/duplicates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          potentialDuplicateId,
          confirmed,
          note: notes[potentialDuplicateId] ?? "",
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "The decision could not be saved.");
        return;
      }
      setMessage(
        confirmed
          ? "Confirmed as a duplicate — kept as one record."
          : "Dismissed — the incoming record will be added as a new charity.",
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
      {pending.length === 0 ? (
        <p className="text-sm text-foreground/65">No possible duplicates waiting for review.</p>
      ) : (
        <div>
          <h2 className="text-sm font-bold">Pending review</h2>
          <ul className="mt-4 space-y-4">
            {pending.map((row) => (
              <li key={row.id} className="rounded-xl border border-black/10 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-foreground/50">
                      Incoming record
                    </p>
                    <p className="mt-1 font-bold">{incomingName(row)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-foreground/50">
                      Existing record
                    </p>
                    <p className="mt-1 font-bold">
                      {row.matched_organisation?.legal_name ?? "Unknown charity"}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-foreground/50">
                  Matched on: {MATCHED_ON_LABEL[row.matched_on]} ·{" "}
                  {new Date(row.created_at).toLocaleString("en-GB")}
                </p>
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
                  <button
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => decide(row.id, true)}
                    type="button"
                  >
                    Same charity — keep existing
                  </button>
                  <button
                    className="rounded-lg border border-black/15 px-4 py-2 text-sm font-bold disabled:opacity-50"
                    disabled={busy}
                    onClick={() => decide(row.id, false)}
                    type="button"
                  >
                    Different charities — add as new
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p aria-live="polite" className="min-h-6 text-sm font-bold">
        {message}
      </p>

      <div>
        <h2 className="text-sm font-bold">History</h2>
        {decided.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/65">No decided duplicates yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-foreground/50">
                  <th className="py-2 pr-4">Incoming record</th>
                  <th className="py-2 pr-4">Existing record</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Decided by</th>
                  <th className="py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((row) => (
                  <tr key={row.id} className="border-b border-black/5 align-top">
                    <td className="py-3 pr-4 font-medium">{incomingName(row)}</td>
                    <td className="py-3 pr-4">
                      {row.matched_organisation?.legal_name ?? "Unknown charity"}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_STYLE[row.status]}`}>
                        {row.status === "confirmed_duplicate" ? "Confirmed duplicate" : "Not a duplicate"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-foreground/65">
                      {personLabel(row.decided_by_user)}
                      {row.decision_note && (
                        <span className="block text-xs text-foreground/50">{row.decision_note}</span>
                      )}
                    </td>
                    <td className="py-3 whitespace-nowrap text-foreground/65">
                      {row.decided_at
                        ? new Date(row.decided_at).toLocaleString("en-GB")
                        : new Date(row.created_at).toLocaleString("en-GB")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
