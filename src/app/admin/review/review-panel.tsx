"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { NETWORK_ERROR_MESSAGE } from "@/lib/network-error";
import { reportError } from "@/lib/error-logging";

export type DataQualityEventRow = {
  id: string;
  raw_source_record_id: string;
  rule_name: string;
  rule_category: string;
  field_value: string | null;
  severity: string;
  suggested_fix: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
  raw_source_records: { raw_payload: unknown } | null;
};

export type StatusFlagRow = {
  id: string;
  organisation_id: string;
  source: string;
  company_number: string;
  previous_status: string;
  new_status: string;
  detected_at: string;
  resolved: boolean;
  resolved_at: string | null;
  organisations: { legal_name: string } | null;
};

const RULE_LABEL: Record<string, string> = {
  client_criteria_needs_review: "Needs review",
  client_criteria_does_not_meet: "Does not meet criteria",
};

const SOURCE_LABEL: Record<string, string> = {
  companies_house: "Companies House",
  charity_commission: "Charity Commission",
};

function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

function recordName(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    // company_name (Companies House), charity_name (Charity Commission), name
    // (a fallback for any other source's raw_payload shape).
    const name = record.company_name ?? record.charity_name ?? record.name;
    if (typeof name === "string" && name.trim()) return name;
  }
  return "Unknown record";
}

export function ReviewPanel({
  initialEvents,
  initialFlags,
}: {
  initialEvents: DataQualityEventRow[];
  initialFlags: StatusFlagRow[];
}) {
  const [events, setEvents] = useState(initialEvents);
  const [flags, setFlags] = useState(initialFlags);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/admin/review");
    if (!response.ok) return;
    const body = await response.json();
    setEvents(body.events as DataQualityEventRow[]);
    setFlags(body.flags as StatusFlagRow[]);
  }

  async function decide(type: "data_quality_event" | "status_flag", id: string, successMessage: string) {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id, note: notes[id] ?? "" }),
      });
      const body = await response.json();
      if (!response.ok) {
        setStatus({ text: body.error ?? "The request could not be completed.", tone: "error" });
        return;
      }
      setStatus({ text: successMessage, tone: "success" });
      await refresh();
    } catch (err) {
      void reportError(err, { operation: "admin.review.decide_client" });
      setStatus({ text: NETWORK_ERROR_MESSAGE, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const openFlags = flags.filter((flag) => !flag.resolved);
  const openEvents = events.filter((event) => !event.resolved);
  const decidedFlags = flags.filter((flag) => flag.resolved);
  const decidedEvents = events.filter((event) => event.resolved);

  return (
    <div className="mt-8 space-y-10">
      <div className="min-h-6">
        {status && <InlineAlert tone={status.tone} message={status.text} />}
      </div>

      <div>
        <h2 className="text-sm font-bold">Status changes</h2>
        <p className="mt-1 text-sm text-foreground/65">
          An organisation&apos;s Companies House or Charity Commission status
          changed away from active/registered. Outreach status is never changed
          automatically — decide what, if anything, this means for any
          in-progress outreach.
        </p>
        {openFlags.length === 0 ? (
          <p className="mt-3 text-sm text-foreground/65">No status changes waiting for review.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {openFlags.map((flag) => (
              <li key={flag.id} className="rounded-xl border border-black/10 p-4">
                <p className="font-bold">{flag.organisations?.legal_name ?? "Unknown organisation"}</p>
                <p className="mt-1 text-sm text-foreground/75">
                  {sourceLabel(flag.source)} {flag.company_number}: {flag.previous_status} → {flag.new_status}
                </p>
                <p className="mt-1 text-xs text-foreground/50">
                  Detected {new Date(flag.detected_at).toLocaleString("en-GB")}
                </p>
                <label className="mt-3 block text-sm font-bold" htmlFor={`flag-note-${flag.id}`}>
                  Note (optional)
                </label>
                <textarea
                  className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2"
                  disabled={busy}
                  id={`flag-note-${flag.id}`}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [flag.id]: event.target.value }))
                  }
                  rows={2}
                  value={notes[flag.id] ?? ""}
                />
                <OriginButton
                  className="mt-3"
                  disabled={busy}
                  size="sm"
                  onClick={() => decide("status_flag", flag.id, "Acknowledged.")}
                  type="button"
                >
                  Acknowledge
                </OriginButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-sm font-bold">Held for review</h2>
        <p className="mt-1 text-sm text-foreground/65">
          Records held out of the working list until there is evidence of
          non-profit or social purpose (F047).
        </p>
        {openEvents.length === 0 ? (
          <p className="mt-3 text-sm text-foreground/65">No records held for review.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {openEvents.map((event) => (
              <li key={event.id} className="rounded-xl border border-black/10 p-4">
                <p className="font-bold">{recordName(event.raw_source_records?.raw_payload)}</p>
                <p className="mt-1 text-sm text-foreground/75">
                  {RULE_LABEL[event.rule_name] ?? event.rule_name}
                  {event.suggested_fix ? ` — ${event.suggested_fix}` : ""}
                </p>
                <p className="mt-1 text-xs text-foreground/50">
                  {new Date(event.created_at).toLocaleString("en-GB")}
                </p>
                <label className="mt-3 block text-sm font-bold" htmlFor={`event-note-${event.id}`}>
                  Note (optional)
                </label>
                <textarea
                  className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2"
                  disabled={busy}
                  id={`event-note-${event.id}`}
                  onChange={(eventChange) =>
                    setNotes((current) => ({ ...current, [event.id]: eventChange.target.value }))
                  }
                  rows={2}
                  value={notes[event.id] ?? ""}
                />
                <OriginButton
                  className="mt-3"
                  disabled={busy}
                  size="sm"
                  onClick={() => decide("data_quality_event", event.id, "Marked reviewed.")}
                  type="button"
                >
                  Mark reviewed
                </OriginButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-sm font-bold">History</h2>
        {decidedEvents.length === 0 && decidedFlags.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/65">Nothing decided yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-foreground/50">
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Item</th>
                  <th className="py-2 pr-4">Detail</th>
                  <th className="py-2">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {decidedFlags.map((flag) => (
                  <tr key={flag.id} className="border-b border-black/5 align-top">
                    <td className="py-3 pr-4">Status change</td>
                    <td className="py-3 pr-4 font-medium">
                      {flag.organisations?.legal_name ?? "Unknown organisation"}
                    </td>
                    <td className="py-3 pr-4 text-foreground/75">
                      {sourceLabel(flag.source)}: {flag.previous_status} → {flag.new_status}
                    </td>
                    <td className="py-3 whitespace-nowrap text-foreground/65">
                      {flag.resolved_at ? new Date(flag.resolved_at).toLocaleString("en-GB") : "—"}
                    </td>
                  </tr>
                ))}
                {decidedEvents.map((event) => (
                  <tr key={event.id} className="border-b border-black/5 align-top">
                    <td className="py-3 pr-4">Review</td>
                    <td className="py-3 pr-4 font-medium">
                      {recordName(event.raw_source_records?.raw_payload)}
                    </td>
                    <td className="py-3 pr-4 text-foreground/75">
                      {RULE_LABEL[event.rule_name] ?? event.rule_name}
                    </td>
                    <td className="py-3 whitespace-nowrap text-foreground/65">
                      {event.resolved_at ? new Date(event.resolved_at).toLocaleString("en-GB") : "—"}
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
