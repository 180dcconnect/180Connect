import {
  TIMELINE_EVENT_LABEL,
  TIMELINE_EVENT_STYLE,
  type TimelineEntry,
  type TimelineTone,
} from "@/lib/timeline";
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

/**
 * F076 AC2 — the dot before each Pill, not the Pill's colour alone: three
 * tones cannot give eight event types eight distinct looks on their own, so
 * each tone carries three fills: "solid" (something created), "hollow"
 * (something received or changed) and "ring" (a heavier border over a faint
 * tint of the same hue — added for #80/#81's decision events when the original
 * six pairings were used up). See @/lib/timeline.ts's TIMELINE_EVENT_STYLE for
 * which type gets which, and its test for the guarantee that no two types ever
 * share a combination.
 */
const DOT_TONE_CLASS: Record<TimelineTone, string> = {
  brand: "border-brand bg-brand",
  neutral: "border-foreground/40 bg-foreground/40",
  warn: "border-amber-600 bg-amber-600",
};

const RING_TONE_CLASS: Record<TimelineTone, string> = {
  brand: "border-brand bg-brand/10",
  neutral: "border-foreground/40 bg-foreground/[0.06]",
  warn: "border-amber-600 bg-amber-600/10",
};

function EventDot({ type }: { type: TimelineEntry["type"] }) {
  const style = TIMELINE_EVENT_STYLE[type];
  if (style.fill === "ring") {
    return (
      <span
        aria-hidden="true"
        className={`inline-block size-3 shrink-0 rounded-full border-[3px] ${RING_TONE_CLASS[style.tone]}`}
      />
    );
  }
  const toneClass = DOT_TONE_CLASS[style.tone];
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full border-2 ${
        style.fill === "solid" ? toneClass : `${toneClass.split(" ")[0]} bg-transparent`
      }`}
    />
  );
}

/**
 * F075: one chronological feed merging emails sent, replies received, notes
 * added/edited, status changes and ownership handovers for this client (AC1),
 * each labelled by type (F076 AC1) and visually distinguishable at a glance
 * (F076 AC2 — EventDot + Pill together, not text alone). `entries` is already
 * built and sorted by @/lib/timeline.ts's `buildTimeline` — this component
 * only renders.
 *
 * A plain presentational component, not a client one: the live-update half of
 * AC3 is TimelineRealtimeRefresher, rendered alongside this in page.tsx, which
 * triggers a server refetch on a relevant change rather than folding realtime
 * payloads into client state here — see that file's header comment for why.
 */
/**
 * `degraded` means at least one of the four timeline sources failed to load
 * (each failure is reported server-side). The entries that did load still
 * render, with a warning above them; only when nothing could be loaded does
 * the section fall back to its full error state.
 */
export function TimelineSection({
  entries,
  degraded,
}: {
  entries: TimelineEntry[];
  degraded: boolean;
}) {
  if (entries.length === 0) {
    if (degraded) {
      return (
        <p className="mt-4 text-sm font-bold text-destructive" role="alert">
          The timeline could not be loaded. Refresh and try again.
        </p>
      );
    }
    return (
      <p className="mt-4 text-sm leading-[1.7] text-foreground/45">
        Nothing has happened with this client yet.
      </p>
    );
  }

  return (
    <>
      {degraded && (
        <p className="mt-4 text-sm font-bold text-destructive" role="alert">
          Some timeline events could not be loaded. Refresh to see the full
          history.
        </p>
      )}
      <ul className="mt-4 space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-xl border border-black/[0.06] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <EventDot type={entry.type} />
              <Pill tone={TIMELINE_EVENT_STYLE[entry.type].tone}>
                {TIMELINE_EVENT_LABEL[entry.type]}
              </Pill>
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
            <>
              <p className="mt-2.5 whitespace-pre-wrap text-sm leading-[1.65] text-foreground/80">
                {entry.summary}
              </p>
              {entry.type === "reply_received" && (
                <a
                  className="mt-2 inline-block text-sm font-semibold text-brand underline underline-offset-2"
                  href={`#thread-reply-${entry.id.slice("reply-".length)}`}
                >
                  View full email thread
                </a>
              )}
            </>
          )}
        </li>
      ))}
      </ul>
    </>
  );
}
