"use client";

import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import {
  AI_GENERATION_ACTIVITIES,
  AI_GENERATION_ACTIVITY_LABELS,
  formatUsd,
  type AiGenerationActivity,
  type AiSpendBucket,
} from "@/lib/dashboard/ai-spend";

/**
 * One colour per activity, fixed across every day, shared by the gauge sticks
 * and the card's legend — a day with only follow-ups is the follow-up colour,
 * never a colour of its own. Five clearly different hues, so a single-activity
 * day is still readable against the legend. Tokens, not hex: the gauge paints
 * SVG strokes, so these are CSS colours rather than Tailwind classes.
 */
export const AI_ACTIVITY_COLOURS: Record<AiGenerationActivity, string> = {
  initial_email: "var(--lead)",
  email_regeneration: "var(--hold)",
  follow_up_email: "var(--brand)",
  client_booklet: "var(--scored)",
  other: "var(--faint)",
};

/**
 * A client boundary around the gauge for one day of spend. The card is a
 * server component and cannot hand the gauge its `valueFormatter` function,
 * so the formatting lives here.
 */
export function AiSpendDayGauge({ bucket }: { bucket: AiSpendBucket }) {
  const segments = AI_GENERATION_ACTIVITIES.filter((activity) => bucket.byActivity[activity] > 0).map(
    (activity) => ({
      id: activity,
      label: AI_GENERATION_ACTIVITY_LABELS[activity],
      value: bucket.byActivity[activity],
      color: AI_ACTIVITY_COLOURS[activity],
    }),
  );

  return (
    <HorizontalStickGauge
      segments={segments}
      stickHeight={10}
      pitch={6.5}
      stickWidth={2.5}
      valueFormatter={formatUsd}
      ariaLabel={`AI spend on ${bucket.label}: ${formatUsd(bucket.totalCostUsd)}`}
    />
  );
}
