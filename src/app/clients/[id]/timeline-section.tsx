import { TIMELINE_EVENT_LABEL, type TimelineEntry, type TimelineEventType } from "@/lib/timeline";
import { Pill } from "./section-card";

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EVENT_TONE: Record<TimelineEventType, "neutral" | "brand" | "warn" | "danger"> = {
  email_sent: "brand",
  reply_received: "brand",
  note_added: "neutral",
  note_edited: "neutral",
  status_changed: "warn",
  ownership_reassigned: "warn",
};

/**
 * F075: one chronological feed merging emails sent, replies received, notes
 * added/edited, status changes and ownership handovers for this client (AC1),
 * each labelled by type (AC2, F076). `entries` is already built and sorted by
 * @/lib/timeline.ts's `buildTimeline` — this component only renders.
 *
 * A plain presentational component, not a client one: the live-update half of
 * AC3 is TimelineRealtimeRefresher, rendered alongside this in page.tsx, which
 * triggers a server refetch on a relevant change rather than folding realtime
 * payloads into client state here — see that file's header comment for why.
 */
export function TimelineSection({ entries, error }: { entries: TimelineEntry[]; error: boolean }) {
  if (error) {
    return (
      <p className="mt-4 text-sm font-bold text-destructive" role="alert">
        The timeline could not be loaded. Refresh and try again.
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="mt-4 text-sm leading-[1.7] text-foreground/45">
        Nothing has happened with this client yet.
      </p>
    );
  }

  return (
    <ul className="mt-4 space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-xl border border-black/[0.06] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={EVENT_TONE[entry.type]}>{TIMELINE_EVENT_LABEL[entry.type]}</Pill>
              <span className="text-[13px] font-bold text-foreground/70">{entry.actorName}</span>
            </div>
            <span className="text-[13px] text-foreground/45">{formatTimestamp(entry.timestamp)}</span>
          </div>

          {entry.handover ? (
            // F257 AC5 — outgoing CAM, incoming CAM and reason each shown as
            // their own labelled field, not folded into one sentence.
            <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm leading-[1.6]">
              <dt className="text-foreground/45">From</dt>
              <dd className="text-foreground/80">{entry.handover.fromName}</dd>
              <dt className="text-foreground/45">To</dt>
              <dd className="text-foreground/80">{entry.handover.toName}</dd>
              <dt className="text-foreground/45">Reason</dt>
              <dd className="text-foreground/80">{entry.handover.reason}</dd>
            </dl>
          ) : (
            <p className="mt-2.5 whitespace-pre-wrap text-sm leading-[1.65] text-foreground/80">
              {entry.summary}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
