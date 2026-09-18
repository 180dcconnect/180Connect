import type { ReactNode } from "react";

import { Rise } from "@/components/dashboard-stage";
import type { FinancialSeries } from "@/lib/financials/financial-series";
import { summariseFunders, type FunderGrantInput } from "@/lib/financials/funders";
import { formatCompactGbp } from "@/lib/income-band";

/**
 * When to make contact, and what to open with.
 *
 * **Why this is not section zero.** Every numbered section on this tab answers a
 * question about the client. This one answers a question about the *approach* —
 * it is the read, not the evidence — so numbering it would put an inference in
 * the same run as five sets of filed figures, and a number is an address for a
 * question, not a slot for a summary. It sits above the run instead, unnumbered
 * and quiet, and everything in it can be traced to a section below.
 *
 * **What a CAM opening this tab actually needs first.** Not the biggest number
 * on the page. Three facts that decide whether today is the day:
 *
 * - **A recent award.** A charity that has just landed money has both budget and
 *   a mandate to spend it, which is the best moment there is to pitch a project.
 *   The award is already on the page — as row one of a paginated table nobody
 *   scrolls to.
 * - **When their year ends.** Project pitches land in the budgeting window or
 *   they land after it. The register publishes the date and nothing on this
 *   record used it for anything but arithmetic.
 * - **A step change in income.** A charity whose income moved sharply has
 *   something to talk about, in either direction — growth needs capacity,
 *   contraction needs cost work.
 *
 * **Nothing invented.** Every line is a filed figure or a date arithmetic on
 * one. No scoring, no "suggested pitch angle", no inference dressed as fact —
 * the strip renders nothing at all rather than reaching for something to say.
 */

/** Below this, a year-on-year move is noise in a small charity's accounts
 *  rather than an event worth opening a conversation with. */
const STEP_CHANGE = 0.15;

/** Past this, an award is history rather than a reason to make contact today. */
const RECENT_AWARD_MONTHS = 24;

/** Whole months between an award date and now, on the same 30.44-day month
 *  `filingRecency` uses. Null for an unparseable or future date. */
function monthsSince(iso: string, now: Date): number | null {
  const then = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const months = Math.floor((now.getTime() - then) / (30.44 * 86_400_000));
  return months < 0 ? null : months;
}

/** Award recency in the units a grant lives in. `formatRelativeTime` drops to a
 *  calendar date after a week, which is right for an email and wrong for an
 *  award that landed nine months ago. */
function monthsAgo(months: number): string {
  if (months < 1) return "this month";
  if (months === 1) return "last month";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "about a year ago" : `${years} years ago`;
}

function Fact({ children }: { children: ReactNode }) {
  return (
    <li className="text-[13px] leading-[1.55] text-dim">
      <span className="text-ink">{children}</span>
    </li>
  );
}

export function WhyNowStrip({
  grants,
  series,
  now = new Date(),
}: {
  grants: readonly FunderGrantInput[];
  series: FinancialSeries;
  /** Injectable so the copy is testable and so a server render is deterministic
   *  within a request. */
  now?: Date;
}) {
  const facts: ReactNode[] = [];

  const { latest } = summariseFunders(grants);
  if (latest) {
    // An award from six years ago is not a reason to call today. Two years is
    // the outer edge of "recent" for a grant cycle.
    const months = monthsSince(latest.awardDate, now);
    if (months !== null && months <= RECENT_AWARD_MONTHS) {
      facts.push(
        <>
          Last award{" "}
          <strong className="font-semibold">
            {latest.amount !== null ? formatCompactGbp(latest.amount) : "of an unpublished amount"}
          </strong>{" "}
          from {latest.name}, {monthsAgo(months)}.
        </>,
      );
    }
  }

  const newest = series.years.at(-1);
  const previous = series.years.at(-2);

  if (newest) {
    const end = new Date(`${newest.periodEnd.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(end.getTime())) {
      facts.push(
        <>
          Financial year ends{" "}
          <strong className="font-semibold">
            {end.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            })}
          </strong>
          .
        </>,
      );
    }
  }

  if (
    newest?.income !== null &&
    newest?.income !== undefined &&
    previous?.income !== null &&
    previous?.income !== undefined &&
    previous.income > 0
  ) {
    const move = (newest.income - previous.income) / previous.income;
    if (Math.abs(move) >= STEP_CHANGE) {
      facts.push(
        <>
          Income{" "}
          <strong className="font-semibold">
            {move > 0 ? "up" : "down"} {Math.round(Math.abs(move) * 100)}%
          </strong>{" "}
          in {newest.label} against {previous.label}.
        </>,
      );
    }
  }

  if (facts.length === 0) return null;

  // The entrance wrapper lives inside the component rather than around it at
  // the call site, because this is the one child of the run that can render
  // nothing at all. An empty `Rise` is still a `motion.div`, and an empty div
  // under the group's `space-y-4` is a phantom 16px gap above section 1.
  return (
    <Rise>
      <div className="rounded-panel border border-rule bg-white px-5 py-4">
        <p className="text-[12.5px] font-semibold text-ink">Why now</p>
        <ul className="mt-2 grid gap-x-8 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((fact, index) => (
            // The facts are fixed in kind and order — award, year end, step
            // change — so the index is a stable identity here, not a positional
            // guess at one.
            <Fact key={index}>{fact}</Fact>
          ))}
        </ul>
      </div>
    </Rise>
  );
}
