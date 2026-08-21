"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import type { DiscrepancyChoice, FieldDiscrepancyRow } from "@/lib/discrepancies";
import { InlineAlert } from "@/components/ui/inline-alert";
import { NETWORK_ERROR_MESSAGE } from "@/lib/network-error";
import { reportError } from "@/lib/error-logging";

const FIELD_LABEL: Record<string, string> = {
  legal_name: "Legal name",
  website: "Website",
  contact_email: "Contact email",
  address_line_1: "Address",
  city: "City",
  postcode: "Postcode",
};

const STATUS_STYLE: Record<FieldDiscrepancyRow["status"], string> = {
  pending: "bg-amber-50 text-amber-800",
  resolved: "bg-black/5 text-foreground/65",
};

function personLabel(person: { full_name: string | null; email: string } | null) {
  if (!person) return "—";
  return person.full_name ?? person.email;
}

function fieldLabel(fieldName: string) {
  return FIELD_LABEL[fieldName] ?? fieldName;
}

export function DiscrepanciesPanel({
  initialDiscrepancies,
}: {
  initialDiscrepancies: FieldDiscrepancyRow[];
}) {
  const [rows, setRows] = useState(initialDiscrepancies);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/admin/discrepancies");
    if (!response.ok) return;
    const body = await response.json();
    setRows(body.discrepancies as FieldDiscrepancyRow[]);
  }

  async function resolve(fieldDiscrepancyId: string, choice: DiscrepancyChoice) {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/discrepancies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldDiscrepancyId,
          choice,
          note: notes[fieldDiscrepancyId] ?? "",
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setStatus({ text: body.error ?? "The decision could not be saved.", tone: "error" });
        return;
      }
      setStatus({
        text: choice === "existing" ? "Kept the existing value." : "Updated to the incoming value.",
        tone: "success",
      });
      await refresh();
    } catch (err) {
      void reportError(err, { operation: "admin.discrepancies.resolve_client" });
      setStatus({ text: NETWORK_ERROR_MESSAGE, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const pending = rows.filter((row) => row.status === "pending");
  const resolved = rows.filter((row) => row.status !== "pending");

  return (
    <div className="mt-8 space-y-10">
      {pending.length === 0 ? (
        <p className="text-sm text-foreground/65">No discrepancies waiting for review.</p>
      ) : (
        <div>
          <h2 className="text-sm font-bold">Pending review</h2>
          <ul className="mt-4 space-y-4">
            {pending.map((row) => (
              <li key={row.id} className="rounded-xl border border-black/10 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-foreground/50">
                  {row.organisation?.legal_name ?? "Unknown charity"} · {fieldLabel(row.field_name)}
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-black/10 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-foreground/50">
                      Existing ({row.existing_source})
                    </p>
                    <p className="mt-1 break-words font-bold">{row.existing_value}</p>
                  </div>
                  <div className="rounded-lg border border-black/10 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-foreground/50">
                      Incoming ({row.incoming_source})
                    </p>
                    <p className="mt-1 break-words font-bold">{row.incoming_value}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-foreground/50">
                  Flagged {new Date(row.created_at).toLocaleString("en-GB")}
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
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => resolve(row.id, "existing")}
                    type="button"
                  >
                    Keep existing
                  </OriginButton>
                  <OriginButton
                    size="sm"
                    disabled={busy}
                    onClick={() => resolve(row.id, "incoming")}
                    type="button"
                  >
                    Use incoming
                  </OriginButton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-6">
        {status && <InlineAlert tone={status.tone} message={status.text} />}
      </div>

      <div>
        <h2 className="text-sm font-bold">History</h2>
        {resolved.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/65">No resolved discrepancies yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-foreground/50">
                  <th className="py-2 pr-4">Charity</th>
                  <th className="py-2 pr-4">Field</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Kept value</th>
                  <th className="py-2 pr-4">Decided by</th>
                  <th className="py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((row) => (
                  <tr key={row.id} className="border-b border-black/5 align-top">
                    <td className="py-3 pr-4 font-medium">
                      {row.organisation?.legal_name ?? "Unknown charity"}
                    </td>
                    <td className="py-3 pr-4">{fieldLabel(row.field_name)}</td>
                    <td className="py-3 pr-4">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_STYLE[row.status]}`}>
                        Resolved
                      </span>
                    </td>
                    <td className="py-3 pr-4 break-words">{row.resolved_value}</td>
                    <td className="py-3 pr-4 text-foreground/65">
                      {personLabel(row.resolved_by_user)}
                      {row.notes && (
                        <span className="block text-xs text-foreground/50">{row.notes}</span>
                      )}
                    </td>
                    <td className="py-3 whitespace-nowrap text-foreground/65">
                      {row.resolved_at
                        ? new Date(row.resolved_at).toLocaleString("en-GB")
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
