import Link from "next/link";
import { myWorkHref, type MyWorkSummary } from "@/lib/dashboard/my-work";

/**
 * F206 — "My work": the first thing on the dashboard, above the platform
 * totals, because the platform totals are not something one person can act on.
 *
 * Four counts, each a link into the client list with the same filter that
 * produced the number, so the tile is a door rather than a fact. No sparklines
 * and no deltas: these are "what is on my desk right now" readings, and a
 * week-on-week arrow on "not yet contacted" would imply a trend where there is
 * only a queue. The trend view of the same work is the Performance section's
 * "Just me" scope, further down.
 *
 * A server component — the counts come from rows the page already has, and
 * nothing here changes without a navigation.
 *
 * Restyled onto the Filed Record language (`docs/app-design-system.md`
 * §Surfaces, `clients/[id]/section-card.tsx`) rather than the dashboard's older
 * one, because the four tiles are the first thing a CAM sees and were the
 * weakest thing on the screen:
 *
 * - `border-rule bg-white rounded-panel`, no shadow. The old
 *   `border-black/[0.06]` is #f0f0f0 on white — 1.06:1, invisible — so a
 *   `shadow-sm` was doing the work a border should, and 16px corners under it
 *   read as a floating widget rather than a card on the page.
 * - The label is sentence case, 13px, `--dim`. It was
 *   `text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40`:
 *   four tiles shouting in caps at 40% opacity is what made them read as one
 *   anonymous widget rather than four different questions.
 * - The count is stated against the book it belongs to — "5 of 12 clients" —
 *   so the four tiles compare at a glance. Deliberately *not* a stick gauge:
 *   the gauge is a progress bar, and on "not yet contacted" a longer bar is
 *   worse news, not more progress.
 * - The affordance is a `--lead` "View" pill seated with the label, not an
 *   arrow beside the numeral: the reading ("5 of 12 clients") keeps the full
 *   width, and the one filled control on the card is what says which part of it
 *   is the door.
 */
export function MyWorkStrip({
  summary,
  actorId,
}: {
  summary: MyWorkSummary;
  actorId: string;
}) {
  const book = summary.owned.toLocaleString();

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {summary.buckets.map((bucket) => {
        // "My clients" is the book the other three are counted against, so it
        // carries no denominator of its own — it *is* the denominator.
        const isBook = bucket.key === "owned";
        // A zero on the three action tiles is good news and should recede. It
        // can't be true of the total: the strip only renders when this actor
        // owns something. `--faint`, never opacity on ink.
        const idle = !isBook && bucket.count === 0;

        return (
          <Link
            key={bucket.key}
            href={myWorkHref(bucket, actorId)}
            className="group flex flex-col rounded-panel bg-white px-5 py-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
          >
            <p className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-body text-[13px] leading-[1.55] text-dim">
                <span>{bucket.label}</span>
                {bucket.hasNew && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-go-wash px-2 py-0.5 font-body text-[11px] leading-none font-semibold text-go">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                    {bucket.newCount && bucket.newCount > 1 ? `${bucket.newCount} new` : "New"}
                  </span>
                )}
              </span>
              {/*
               * A span wearing the button, not a `<button>`: the whole tile is
               * the link, and interactive content inside an `<a>` is invalid
               * HTML (and would give the tile two tab stops for one action).
               */}
              <span className="shrink-0 rounded-lg bg-lead px-3 py-1.5 font-body text-[12px] leading-none font-semibold text-paper transition-colors duration-200 group-hover:bg-lead-mid">
                View
              </span>
            </p>

            <p className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-6">
              <span
                className={`font-body text-[clamp(1.75rem,4vw,2.5rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums ${
                  idle ? "text-faint" : "text-ink"
                }`}
              >
                {bucket.count.toLocaleString()}
              </span>
              {!isBook && (
                <span className="font-body text-[13px] leading-[1.55] text-dim">
                  of {book} clients
                </span>
              )}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

export default MyWorkStrip;
