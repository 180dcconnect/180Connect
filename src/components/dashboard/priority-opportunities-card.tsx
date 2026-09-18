import Link from "next/link";

import { PriorityMiniDial } from "@/components/dashboard/priority-mini-dial";
import type { PriorityOpportunity } from "@/lib/priority-opportunities";

/**
 * Priority Opportunities — the ranked SCOUT shortlist on the dashboard ("Your
 * Priority Opportunities": the viewer's own book plus unclaimed clients). The
 * `showOwner` variant is the team-wide reading, kept for a screen that ranks
 * the whole pipeline.
 *
 * A grid of one card per client: rank, name, the score on the same instrument
 * the record header uses, what is pushing that score up, and the one next move
 * — open the record.
 *
 * One action, not two. The card used to pair this with "Generate Booklet",
 * pointing at the same client through a `?booklet=generate` deep link, which
 * made the two buttons read as a choice when the difference between them was a
 * query string. The booklet deep link still exists on the client list's quick
 * actions, where it sits next to the other record-level jobs and is not
 * competing with the only thing this card is for.
 *
 * The gauge is `PriorityMiniDial` — the record header's instrument at card
 * size, reading the one scale definition both share, so a client sitting in
 * High here sits in High there, in the same green. The card never re-decides
 * a band or a colour of its own.
 *
 * "Why it scores highly" names what each check actually found — "Works in
 * Education", "£1.4m income (2024 accounts)", "6 matched grants" — rather than
 * the check that read it. It used to print the check's name and how strong the
 * reading was ("Sector: strong"), which told a CAM the engine liked something
 * they could already read two lines above and nothing they could act on. The
 * checks are still the record page's five, so the two screens agree; only the
 * wording moved from the lever to the fact.
 *
 * The percentages are shares of the *lift* — of what pushed this score above a
 * record with nothing on it — not shares of the score itself. Under the older
 * composition maths a check with nothing on record still came back holding a
 * fifth of the score, which is true of the arithmetic and false under this
 * heading. See `scoutLiftShares`.
 *
 * The shares are drawn rather than spelled out. Repeating "% of score" on
 * every line said the same four words three times and still left the ranking to
 * be worked out by comparing numbers; the unit is stated once beside the
 * heading and each line carries a bar, so which check is doing the work is the
 * first thing the eye lands on.
 *
 * Under the lines, what the score could not read at all. A card showing only
 * what lifted a number implies the rest was weighed and found wanting, when
 * often it was never there — and "No accounts filed" is something a CAM can
 * actually go and fix.
 */

/**
 * Whether any line carries a share — the fallback context lines ("Works in
 * Healthcare") carry none, as do the lines of a score with nothing lifting it,
 * and a heading announcing a share over lines that have no numbers would be
 * promising something absent.
 */
function hasShares(highlights: PriorityOpportunity["highlights"]): boolean {
  return highlights.some((highlight) => highlight.sharePct !== null);
}

export function PriorityOpportunitiesCard({
  opportunities,
  heading = "Priority Opportunities",
  intro = "The highest-scored clients worth talking to next.",
  viewAllHref = "/clients",
  viewAllLabel = "View all clients",
  showOwner = false,
  emptyMessage = "No scored clients to show yet. They appear here once scoring has run.",
}: {
  opportunities: PriorityOpportunity[];
  heading?: string;
  intro?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  /** Team-wide variant names each client's owner; the personal one has no need to. */
  showOwner?: boolean;
  emptyMessage?: string;
}) {
  return (
    <section aria-label={heading}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="font-body text-[16px] font-semibold tracking-tight text-ink">
            {heading}{" "}
            <span className="font-medium text-dim">
              {opportunities.length === 0
                ? ""
                : `· ${opportunities.length} ${opportunities.length === 1 ? "opportunity" : "opportunities"}`}
            </span>
          </h3>
          <p className="mt-1 font-body text-[12px] leading-[1.55] text-dim">{intro}</p>
        </div>
        {opportunities.length > 0 && (
          <Link
            href={viewAllHref}
            className="font-body text-[12px] font-semibold text-dim transition-colors hover:text-lead focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
          >
            {viewAllLabel} →
          </Link>
        )}
      </div>

      {opportunities.length === 0 ? (
        <p className="mt-3 rounded-panel border border-rule bg-white px-5 py-8 font-body text-sm leading-[1.7] text-dim">
          {emptyMessage}
        </p>
      ) : (
        <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {opportunities.map((opportunity, index) => {
            const context = showOwner
              ? opportunity.owner_name?.trim()
                ? `Owned by ${opportunity.owner_name.trim()}`
                : "No owner yet"
              : [opportunity.sector?.trim(), opportunity.city?.trim()]
                  .filter(Boolean)
                  .join(" · ");
            return (
              <li
                key={opportunity.id}
                className="flex h-full flex-col rounded-panel border border-rule bg-white p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="mt-1 inline-flex items-center rounded-md bg-paper-sunk px-2 py-0.5 font-body text-[11px] font-bold tabular-nums text-dim">
                    #{index + 1}
                  </span>
                  <PriorityMiniDial
                    score={opportunity.priority_score}
                    displayScore={opportunity.displayScore}
                  />
                </div>

                <Link
                  href={`/clients/${opportunity.id}`}
                  className="mt-3 line-clamp-2 font-body text-[15px] leading-[1.35] font-bold text-ink transition-colors hover:text-lead focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
                >
                  {opportunity.legal_name}
                </Link>
                {context && (
                  <p className="mt-1 truncate font-body text-[12px] text-dim">{context}</p>
                )}
                {opportunity.mission && (
                  <p className="mt-2 line-clamp-3 font-body text-[12.5px] leading-[1.6] text-dim">
                    {opportunity.mission}
                  </p>
                )}

                {opportunity.highlights.length > 0 && (
                  // No rule above this heading: it is a continuation of the
                  // card's own story, and the line only cut the block off from
                  // the mission it is meant to explain.
                  <div className="mt-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-body text-[11px] font-bold tracking-wide text-dim uppercase">
                        Why it scores highly
                      </p>
                      {/* The unit, said once instead of on all three lines. */}
                      {hasShares(opportunity.highlights) && (
                        <p className="font-body text-[10px] font-medium text-faint">
                          share of the lift
                        </p>
                      )}
                    </div>

                    <ul className="mt-2 space-y-1.5">
                      {opportunity.highlights.map((highlight) => (
                        <li
                          key={highlight.label}
                          className="flex items-center gap-2 font-body text-[12.5px] leading-[1.5] text-ink"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {highlight.label}
                            {highlight.strength && (
                              <span className="text-dim">: {highlight.strength}</span>
                            )}
                          </span>
                          {highlight.sharePct !== null && (
                            <>
                              {/* Scaled against the whole lift, not against the
                                  largest line here: a 40% check did 40% of the
                                  lifting that put this client on the card. */}
                              <span
                                aria-hidden="true"
                                className="h-1 w-9 shrink-0 overflow-hidden rounded-full bg-rule-soft"
                              >
                                <span
                                  className="block h-full rounded-full bg-lead"
                                  style={{ width: `${Math.min(100, highlight.sharePct)}%` }}
                                />
                              </span>
                              <span className="w-7 shrink-0 text-right font-body text-[11.5px] font-semibold text-dim tabular-nums">
                                {highlight.sharePct}%
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>

                    {opportunity.gaps.length > 0 && (
                      // Absence, said plainly and last: not a warning, just
                      // the part of the picture nobody has filled in yet.
                      <p className="mt-2.5 font-body text-[11.5px] leading-[1.5] text-faint">
                        Not scored on: {opportunity.gaps.join(", ").toLowerCase()}
                      </p>
                    )}
                  </div>
                )}

                {/* The card's one action, and the only blue on it. Full width
                    now that it is alone: a half-width button beside a gap
                    reads as a control whose partner failed to render. */}
                <div className="mt-auto pt-4">
                  <Link
                    href={`/clients/${opportunity.id}`}
                    aria-label={`View ${opportunity.legal_name}`}
                    className="flex w-full items-center justify-center rounded-lg bg-lead px-3 py-2 font-body text-[12px] font-bold text-white transition-colors hover:bg-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
                  >
                    View
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default PriorityOpportunitiesCard;
