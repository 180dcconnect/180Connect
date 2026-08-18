"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import type { EntityMatchCandidateRow } from "@/lib/duplicates";

// "rejected" is part of the underlying match_status enum (a future matcher's "this
// candidate pairing was wrong" outcome) but decide_duplicate_flag never writes it — see
// 20260809150000_create_entity_match_candidates.sql's header. Given a style anyway so a
// row with it doesn't render blank rather than because this admin flow can produce one.
const STATUS_STYLE: Record<EntityMatchCandidateRow["match_status"], string> = {
  pending: "bg-amber-50 text-amber-800",
  confirmed_match: "bg-black/5 text-foreground/65",
  confirmed_new: "bg-green-50 text-green-800",
  rejected: "bg-red-50 text-red-800",
};

const STATUS_LABEL: Record<EntityMatchCandidateRow["match_status"], string> = {
  pending: "Pending",
  confirmed_match: "Confirmed duplicate",
  confirmed_new: "Not a duplicate",
  rejected: "Rejected",
};

// F042's matcher only ever produces exact_charity_number or fuzzy_name (see the
// migration header for why address_match/manual are reserved for a future matcher);
// all four are labelled so this doesn't silently drop a row if that changes.
const MATCH_METHOD_LABEL: Record<EntityMatchCandidateRow["match_method"], string> = {
  exact_charity_number: "Registration number",
  fuzzy_name: "Name and postcode",
  address_match: "Address",
  manual: "Manual",
};

function personLabel(person: { full_name: string | null; email: string } | null) {
  if (!person) return "—";
  return person.full_name ?? person.email;
}

function incomingName(row: EntityMatchCandidateRow) {
  const payload = row.raw_source_record?.raw_payload;
  return payload?.charity_name ?? payload?.company_name ?? "Unknown incoming record";
}

export function DuplicatesPanel({
  initialDuplicates,
}: {
  initialDuplicates: EntityMatchCandidateRow[];
}) {
  const [rows, setRows] = useState(initialDuplicates);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/admin/duplicates");
    if (!response.ok) return;
    const body = await response.json();
    setRows(body.duplicates as EntityMatchCandidateRow[]);
  }

  async function decide(entityMatchCandidateId: string, confirmed: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/duplicates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityMatchCandidateId,
          confirmed,
          note: notes[entityMatchCandidateId] ?? "",
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

  const pending = rows.filter((row) => row.match_status === "pending");
  const decided = rows.filter((row) => row.match_status !== "pending");

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
                      {row.candidate_organisation?.legal_name ?? "Unknown charity"}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-foreground/50">
                  Matched on: {MATCH_METHOD_LABEL[row.match_method]} ·{" "}
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
                  <OriginButton
                    size="sm"
                    disabled={busy}
                    onClick={() => decide(row.id, true)}
                    type="button"
                  >
                    Same charity — keep existing
                  </OriginButton>
                  <OriginButton
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => decide(row.id, false)}
                    type="button"
                  >
                    Different charities — add as new
                  </OriginButton>
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
                      {row.candidate_organisation?.legal_name ?? "Unknown charity"}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_STYLE[row.match_status]}`}>
                        {STATUS_LABEL[row.match_status]}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-foreground/65">
                      {personLabel(row.reviewed_by_user)}
                      {row.notes && (
                        <span className="block text-xs text-foreground/50">{row.notes}</span>
                      )}
                    </td>
                    <td className="py-3 whitespace-nowrap text-foreground/65">
                      {row.reviewed_at
                        ? new Date(row.reviewed_at).toLocaleString("en-GB")
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
