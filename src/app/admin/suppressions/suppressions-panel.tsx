"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SuppressionRow } from "@/lib/suppressions";

type OrganisationOption = { id: string; legal_name: string };

const STATUS_STYLE: Record<SuppressionRow["status"], string> = {
  pending: "bg-amber-50 text-amber-800",
  active: "bg-red-50 text-red-800",
  rejected: "bg-black/5 text-foreground/65",
  lifted: "bg-green-50 text-green-800",
};

function personLabel(person: { full_name: string | null; email: string } | null) {
  if (!person) return "—";
  return person.full_name ?? person.email;
}

export function SuppressionsPanel({
  initialSuppressions,
  organisations,
}: {
  initialSuppressions: SuppressionRow[];
  organisations: OrganisationOption[];
}) {
  const [rows, setRows] = useState(initialSuppressions);
  const [organisationId, setOrganisationId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [liftReasons, setLiftReasons] = useState<Record<string, string>>({});
  const [activeLiftId, setActiveLiftId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/admin/suppressions");
    if (!response.ok) return;
    const body = await response.json();
    setRows(body.suppressions as SuppressionRow[]);
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId, reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "The charity could not be suppressed.");
        return;
      }
      setMessage("Suppressed. Outreach to this charity is now blocked.");
      setOrganisationId("");
      setReason("");
      await refresh();
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(suppressionId: string, approve: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/suppressions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suppressionId,
          approve,
          note: notes[suppressionId] ?? "",
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "The decision could not be saved.");
        return;
      }
      setMessage(approve ? "Request approved. Outreach is now blocked." : "Request rejected.");
      await refresh();
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function lift(suppressionId: string) {
    const liftReason = (liftReasons[suppressionId] ?? "").trim();
    if (!liftReason) {
      setMessage("A reason is required to lift suppression.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/suppressions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "lift",
          suppressionId,
          reason: liftReason,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "The suppression could not be lifted.");
        return;
      }
      setMessage("Suppression lifted. Outreach to this charity is now unblocked.");
      setActiveLiftId(null);
      setLiftReasons((current) => {
        const next = { ...current };
        delete next[suppressionId];
        return next;
      });
      await refresh();
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const pending = rows.filter((row) => row.status === "pending");
  const active = rows.filter((row) => row.status === "active");
  const decided = rows.filter((row) => row.status !== "pending");

  return (
    <div className="mt-8 space-y-10">
      <form onSubmit={submitCreate}>
        <h2 className="text-sm font-bold">Suppress a charity directly</h2>
        <label className="mt-3 block text-sm font-bold" htmlFor="organisation">
          Charity
        </label>
        <Select disabled={busy} onValueChange={setOrganisationId} value={organisationId}>
          <SelectTrigger id="organisation" className="mt-2 w-full text-sm">
            <SelectValue placeholder="Select a charity…" />
          </SelectTrigger>
          <SelectContent>
            {organisations.map((organisation) => (
              <SelectItem key={organisation.id} value={organisation.id}>
                {organisation.legal_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="mt-4 block text-sm font-bold" htmlFor="reason">
          Reason
        </label>
        <p className="mt-1 text-sm text-foreground/65">Required, and kept on file.</p>
        <textarea
          className="mt-2 w-full rounded-lg border border-black/15 bg-white px-3 py-2"
          disabled={busy}
          id="reason"
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          value={reason}
        />

        <OriginButton
          disabled={busy || !organisationId || reason.trim() === ""}
          loading={busy}
          size="md"
          type="submit"
          className="mt-4"
        >
          {busy ? "Suppressing…" : "Suppress"}
        </OriginButton>

        <p aria-live="polite" className="mt-4 min-h-6 text-sm font-bold">
          {message}
        </p>
      </form>

      {pending.length > 0 && (
        <div>
          <h2 className="text-sm font-bold">Pending requests</h2>
          <p className="mt-1 text-sm text-foreground/65">
            Requested by a CAM — approve to suppress, or reject to leave the charity as is.
          </p>
          <ul className="mt-4 space-y-4">
            {pending.map((row) => (
              <li key={row.id} className="rounded-xl border border-black/10 p-4">
                <p className="font-bold">{row.organisations?.legal_name ?? "Unknown charity"}</p>
                <p className="mt-1 text-sm text-foreground/75">{row.reason}</p>
                <p className="mt-1 text-xs text-foreground/50">
                  Requested by {personLabel(row.requested_by_user)} on{" "}
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
                    Approve
                  </OriginButton>
                  <OriginButton
                    variant="outline"
                    size="sm"
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
        </div>
      )}

      {active.length > 0 && (
        <div>
          <h2 className="text-sm font-bold">Active suppressions ({active.length})</h2>
          <p className="mt-1 text-sm text-foreground/65">
            Currently suppressed charities. Outreach is blocked and records are hidden from standard lists.
            Lifting suppression restores visibility and allows outreach.
          </p>
          <ul className="mt-4 space-y-4">
            {active.map((row) => (
              <li key={row.id} className="rounded-xl border border-destructive/20 bg-destructive/[0.02] p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{row.organisations?.legal_name ?? "Unknown charity"}</p>
                    <p className="mt-1 text-sm text-foreground/75">{row.reason}</p>
                    <p className="mt-1 text-xs text-foreground/50">
                      Suppressed by {personLabel(row.decided_by_user ?? row.requested_by_user)} on{" "}
                      {row.decided_at
                        ? new Date(row.decided_at).toLocaleString("en-GB")
                        : new Date(row.created_at).toLocaleString("en-GB")}
                    </p>
                  </div>
                  {activeLiftId !== row.id && (
                    <OriginButton
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setActiveLiftId(row.id);
                        setMessage("");
                      }}
                      type="button"
                      className="shrink-0"
                    >
                      Lift suppression
                    </OriginButton>
                  )}
                </div>

                {activeLiftId === row.id && (
                  <div className="mt-4 border-t border-black/10 pt-4">
                    <label className="block text-sm font-bold" htmlFor={`lift-reason-${row.id}`}>
                      Reason for lifting suppression
                    </label>
                    <p className="mt-1 text-xs text-foreground/65">
                      Required, and kept on file for audit tracking.
                    </p>
                    <textarea
                      className="mt-2 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
                      disabled={busy}
                      id={`lift-reason-${row.id}`}
                      placeholder="Why this suppression is being lifted (e.g. mistakenly suppressed, client re-engaged)"
                      onChange={(event) =>
                        setLiftReasons((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                      rows={2}
                      value={liftReasons[row.id] ?? ""}
                    />
                    <div className="mt-3 flex gap-3">
                      <OriginButton
                        size="sm"
                        disabled={busy || !(liftReasons[row.id] ?? "").trim()}
                        loading={busy}
                        onClick={() => lift(row.id)}
                        type="button"
                      >
                        Confirm lift suppression
                      </OriginButton>
                      <OriginButton
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setActiveLiftId(null);
                          setLiftReasons((current) => {
                            const next = { ...current };
                            delete next[row.id];
                            return next;
                          });
                        }}
                        type="button"
                      >
                        Cancel
                      </OriginButton>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-sm font-bold">History</h2>
        {decided.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/65">No decided suppressions yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-foreground/50">
                  <th className="py-2 pr-4">Charity</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4">Requested by</th>
                  <th className="py-2 pr-4">Decided by / Note</th>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((row) => (
                  <tr key={row.id} className="border-b border-black/5 align-top">
                    <td className="py-3 pr-4 font-medium">
                      {row.organisations?.legal_name ?? "Unknown charity"}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_STYLE[row.status]}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-foreground/75">{row.reason}</td>
                    <td className="py-3 pr-4 text-foreground/65">
                      {personLabel(row.requested_by_user)}
                    </td>
                    <td className="py-3 pr-4 text-foreground/65">
                      {personLabel(row.decided_by_user)}
                      {row.decision_note && (
                        <span className="block text-xs text-foreground/50">{row.decision_note}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap text-foreground/65">
                      {row.decided_at
                        ? new Date(row.decided_at).toLocaleString("en-GB")
                        : new Date(row.created_at).toLocaleString("en-GB")}
                    </td>
                    <td className="py-3 text-right">
                      {row.status === "active" && (
                        <OriginButton
                          variant="ghost"
                          size="xs"
                          disabled={busy}
                          onClick={() => {
                            setActiveLiftId(row.id);
                            setMessage("");
                          }}
                          type="button"
                        >
                          Lift
                        </OriginButton>
                      )}
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
