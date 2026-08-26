import type { ChangeHistoryEntry } from "@/lib/change-history";
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
 * F186 — the admin's field-level audit of what changed on this client's
 * record. A plain presentational server component, same split as
 * TimelineSection: entries arrive built and sorted by @/lib/change-history.ts,
 * and live updates come free from TimelineRealtimeRefresher (rendered once for
 * the page), whose audit_log subscription already matches every insert on this
 * client regardless of action.
 *
 * Rejected suggestions render with an explicit "Not applied" pill rather than
 * being dropped: who proposed what, and why it was declined, is exactly the
 * data-quality signal F186 exists to surface.
 */
export function ChangeHistorySection({
  entries,
  degraded,
}: {
  entries: ChangeHistoryEntry[];
  degraded: boolean;
}) {
  if (entries.length === 0) {
    if (degraded) {
      return (
        <p className="mt-4 text-sm font-bold text-destructive" role="alert">
          The change history could not be loaded. Refresh and try again.
        </p>
      );
    }
    return (
      <p className="mt-4 text-sm leading-[1.7] text-foreground/45">
        No recorded changes for this client.
      </p>
    );
  }

  return (
    <>
      {degraded && (
        <p className="mt-4 text-sm font-bold text-destructive" role="alert">
          Some change history could not be loaded. Refresh to see the full
          history.
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-xl border border-black/[0.06] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={entry.action === "edit_suggestion_approved" ? "brand" : "neutral"}>
                  {entry.label}
                </Pill>
                {entry.applied === false && <Pill tone="warn">Not applied</Pill>}
                {entry.fieldLabel && (
                  <span className="text-[13px] font-bold text-foreground/70">
                    {entry.fieldLabel}
                  </span>
                )}
                <span className="text-[13px] text-foreground/45">by</span>
                <span className="text-[13px] font-bold text-foreground/70">{entry.actorName}</span>
              </div>
              <span className="text-[13px] text-foreground/45">
                {formatTimestamp(entry.timestamp)}
              </span>
            </div>

            {/* Three shapes, each readable on its own:
                - a full transition ("X → Y") for an applied change;
                - "Set to Y" for the discrepancy resolvers, whose rows record
                  only the winning value, not what it replaced;
                - a rejected suggestion, where the trail proves what the
                  record was kept as (`from`) — the proposal itself lives on
                  the edit_suggestions row, not here. */}
            {entry.applied === false && entry.from !== null && (
              <p className="mt-2.5 text-sm leading-[1.65] text-foreground/55">
                Record kept: &ldquo;{entry.from}&rdquo;
              </p>
            )}
            {entry.applied !== false && entry.from !== null && (
              <p className="mt-2.5 text-sm leading-[1.65] text-foreground/80">
                {entry.from ?? <span className="text-foreground/35">(empty)</span>}
                {" → "}
                {entry.to ?? <span className="text-foreground/35">(empty)</span>}
              </p>
            )}
            {entry.applied !== false && entry.from === null && entry.to !== null && (
              <p className="mt-2.5 text-sm leading-[1.65] text-foreground/80">
                Set to &ldquo;{entry.to}&rdquo;
              </p>
            )}
            {entry.note && (
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-[1.65] text-foreground/55">
                {entry.note}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
