import {
  AI_GENERATION_ACTIVITIES,
  AI_GENERATION_ACTIVITY_LABELS,
  formatUsd,
  type AiGenerationActivity,
  type AiSpendBucket,
  type AiSpendSummary,
} from "@/lib/dashboard/ai-spend";

export const AI_ACTIVITY_COLOURS: Record<AiGenerationActivity, string> = {
  initial_email: "var(--lead)",
  email_regeneration: "var(--hold)",
  follow_up_email: "var(--brand)",
  client_booklet: "var(--scored)",
  other: "var(--faint)",
};

const CHART_WIDTH = 480;
const CHART_HEIGHT = 224;
const PLOT = { top: 18, right: 16, bottom: 174, left: 52 } as const;
const TICK_COUNT = 4;
const STICK_COUNT = 24;

type DaySpend = AiSpendBucket & { label: string };

function utcDay(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dailySpend(summary: AiSpendSummary): DaySpend[] {
  const byDay = new Map(summary.spendByDay.map((bucket) => [bucket.key, bucket]));
  const days: DaySpend[] = [];
  const end = utcDay(summary.periodTo).getTime();

  for (let day = utcDay(summary.periodFrom); day.getTime() <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const key = isoDay(day);
    const bucket = byDay.get(key);
    days.push(
      bucket ?? {
        key,
        label: day.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
        totalCostUsd: 0,
        byActivity: {
          initial_email: 0,
          email_regeneration: 0,
          follow_up_email: 0,
          client_booklet: 0,
          other: 0,
        },
      },
    );
  }

  return days;
}

function niceStep(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = [1, 2, 2.5, 5, 10].find((candidate) => normalised <= candidate) ?? 10;
  return step * magnitude;
}

function axisMaximum(days: DaySpend[]): number {
  const maximum = Math.max(...days.map((day) => day.totalCostUsd), 0);
  return niceStep(maximum / (TICK_COUNT - 1)) * (TICK_COUNT - 1);
}

function stickActivities(day: DaySpend, count: number): AiGenerationActivity[] {
  if (count === 0) return [];

  const positive = AI_GENERATION_ACTIVITIES.filter((activity) => day.byActivity[activity] > 0);
  const allocation = positive.map((activity) => ({
    activity,
    count: Math.max(1, Math.round((day.byActivity[activity] / day.totalCostUsd) * count)),
  }));
  let allocated = allocation.reduce((total, item) => total + item.count, 0);

  while (allocated > count) {
    const reducible = allocation.filter((item) => item.count > 1);
    if (reducible.length === 0) break;
    const largest = reducible.reduce((result, item) =>
      item.count > result.count ? item : result,
    );
    largest.count -= 1;
    allocated -= 1;
  }
  while (allocated < count) {
    const largest = allocation.reduce((result, item) =>
      day.byActivity[item.activity] > day.byActivity[result.activity] ? item : result,
    );
    largest.count += 1;
    allocated += 1;
  }

  return allocation.flatMap(({ activity, count: activityCount }) =>
    Array.from({ length: activityCount }, () => activity),
  );
}

function xLabels(days: DaySpend[]): number[] {
  if (days.length <= 3) return days.map((_, index) => index);
  const middle = Math.floor((days.length - 1) / 2);
  return [0, middle, days.length - 1];
}

export function AiSpendDailyChart({ summary }: { summary: AiSpendSummary }) {
  const days = dailySpend(summary);
  const max = axisMaximum(days);
  const plotWidth = CHART_WIDTH - PLOT.left - PLOT.right;
  const plotHeight = PLOT.bottom - PLOT.top;
  const bandWidth = plotWidth / Math.max(days.length, 1);
  const stickWidth = Math.max(2, Math.min(10, bandWidth * 0.56));
  const stickPitch = plotHeight / STICK_COUNT;
  const labels = new Set(xLabels(days));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="font-body text-[13px] font-semibold text-ink">Spend by day</h4>
        <p className="font-body text-[12px] text-dim">{summary.periodFrom} to {summary.periodTo}</p>
      </div>
      <svg
        role="img"
        aria-label={`Daily AI spend from ${summary.periodFrom} to ${summary.periodTo}`}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="block h-auto w-full overflow-visible"
      >
        {Array.from({ length: TICK_COUNT }, (_, index) => {
          const value = (max / (TICK_COUNT - 1)) * index;
          const y = PLOT.bottom - (plotHeight / (TICK_COUNT - 1)) * index;
          return (
            <g key={value}>
              <line x1={PLOT.left} x2={CHART_WIDTH - PLOT.right} y1={y} y2={y} stroke="var(--rule-soft)" />
              <text x={PLOT.left - 8} y={y + 3.5} textAnchor="end" fill="var(--dim)" className="font-body text-[10px]">
                {formatUsd(value)}
              </text>
            </g>
          );
        })}

        <line
          x1={PLOT.left}
          x2={CHART_WIDTH - PLOT.right}
          y1={PLOT.bottom}
          y2={PLOT.bottom}
          stroke="var(--rule)"
        />

        {days.map((day, index) => {
          const sticks = stickActivities(
            day,
            day.totalCostUsd > 0 ? Math.max(1, Math.round((day.totalCostUsd / max) * STICK_COUNT)) : 0,
          );
          const x = PLOT.left + index * bandWidth + (bandWidth - stickWidth) / 2;
          return (
            <g key={day.key}>
              <title>{`${day.label}: ${formatUsd(day.totalCostUsd)}`}</title>
              {sticks.map((activity, stickIndex) => (
                <rect
                  key={`${activity}-${stickIndex}`}
                  x={x}
                  y={PLOT.bottom - (stickIndex + 1) * stickPitch + 1}
                  width={stickWidth}
                  height={Math.max(1, stickPitch - 2)}
                  rx={1}
                  fill={AI_ACTIVITY_COLOURS[activity]}
                />
              ))}
              {labels.has(index) && (
                <text
                  x={PLOT.left + index * bandWidth + bandWidth / 2}
                  y={PLOT.bottom + 19}
                  textAnchor="middle"
                  fill="var(--dim)"
                  className="font-body text-[10px]"
                >
                  {day.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-body text-[11px] text-dim">
        {AI_GENERATION_ACTIVITIES.map((activity) => (
          <span key={activity} className="inline-flex items-center gap-1.5">
            <i aria-hidden className="size-1.5 rounded-full" style={{ background: AI_ACTIVITY_COLOURS[activity] }} />
            {AI_GENERATION_ACTIVITY_LABELS[activity]}
          </span>
        ))}
      </div>
    </div>
  );
}
