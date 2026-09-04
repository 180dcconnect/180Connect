import { HeartHandshake, Users } from "lucide-react";

import type { FinancialSeries } from "@/lib/financials/financial-series";

/**
 * How the organisation is staffed, and which way that is moving.
 *
 * **Why it is a row and not a footnote.** A £400k charity run by two employees
 * and ninety volunteers is a different engagement from a £400k charity with
 * twelve employees and none — same income, same band, same priority score,
 * completely different project. Income cannot tell them apart and this is the
 * only place on the record that can. It previously rendered as a caption under
 * the headline figures, which is why nobody knew it existed.
 *
 * **The trend was already in memory.** `series.years[]` carries `employees` and
 * `volunteers` for every filed period; the card that used to own this read only
 * the newest year that published them and dropped the rest. The sparkline costs
 * no query — on the staging register 305 clients have two or more years of
 * headcount sitting in data the page already fetches.
 *
 * **A filed zero is a zero.** "No paid staff" is a real and useful answer, so
 * the checks are against null, never falsiness. Absence of a figure is the only
 * thing that suppresses a line.
 *
 * **The newest year that reported, not the newest year.** The latest return is
 * often a totals-only filing while the one before it carries the counts, and
 * "no headcount published this year" is not the claim "no employees".
 */
function Sparkline({
  values,
  colour,
}: {
  /** Oldest first. At least two points, or the caller should not render this. */
  values: number[];
  colour: string;
}) {
  const width = 54;
  const height = 16;
  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat run would divide by zero; draw it down the middle instead of at the
  // top, which is what a zero-height range would otherwise imply.
  const span = max - min;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = span === 0 ? height / 2 : height - ((value - min) / span) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      viewBox={`-1 -1 ${width + 2} ${height + 2}`}
      className="h-4 w-[54px] shrink-0 self-center"
    >
      <polyline
        points={points}
        fill="none"
        stroke={colour}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={
          span === 0
            ? height / 2
            : height - ((values[values.length - 1]! - min) / span) * height
        }
        r={1.9}
        fill={colour}
      />
    </svg>
  );
}

function Count({
  icon,
  value,
  singular,
  plural,
  trend,
  colour,
}: {
  icon: React.ReactNode;
  value: number;
  singular: string;
  plural: string;
  trend: number[];
  colour: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5 text-[13px] text-ink">
      <span aria-hidden="true" className="shrink-0 self-center text-faint [&_svg]:size-3.5">
        {icon}
      </span>
      <span className="font-mono font-semibold tabular-nums">
        {value.toLocaleString("en-GB")}
      </span>
      <span className="text-dim">{value === 1 ? singular : plural}</span>
      {trend.length >= 2 && <Sparkline values={trend} colour={colour} />}
    </span>
  );
}

export function StaffingRow({ series }: { series: FinancialSeries }) {
  const reported = [...series.years]
    .reverse()
    .find((year) => year.employees !== null || year.volunteers !== null);
  if (!reported) return null;

  // Oldest first, only the years that published a figure — a gap year would
  // otherwise draw as a dive to zero.
  const employeeTrend = series.years
    .map((year) => year.employees)
    .filter((value): value is number => value !== null);
  const volunteerTrend = series.years
    .map((year) => year.volunteers)
    .filter((value): value is number => value !== null);

  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 border-t border-rule-soft pt-3.5">
      <span className="text-[12.5px] text-dim">
        Staffing <span className="text-faint">({reported.label} return)</span>
      </span>
      {reported.employees !== null && (
        <Count
          colour="#175cd3"
          icon={<Users />}
          plural="employees"
          singular="employee"
          trend={employeeTrend}
          value={reported.employees}
        />
      )}
      {reported.volunteers !== null && (
        <Count
          colour="#067647"
          icon={<HeartHandshake />}
          plural="volunteers"
          singular="volunteer"
          trend={volunteerTrend}
          value={reported.volunteers}
        />
      )}
      {(employeeTrend.length >= 2 || volunteerTrend.length >= 2) && (
        <span className="text-[11.5px] text-faint">
          Trend across {Math.max(employeeTrend.length, volunteerTrend.length)} filed years
        </span>
      )}
    </div>
  );
}
