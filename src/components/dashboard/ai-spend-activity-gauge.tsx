"use client";

import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import {
  aiSpendActivityRows,
  formatUsd,
  type AiSpendSummary,
} from "@/lib/dashboard/ai-spend";

/**
 * Where the month's AI spend went, as one row of the app's sticks.
 *
 * The card answers two questions about the same money, and this is the first:
 * *what* is being spent on. The second — *when* — is the day chart underneath.
 * Before this, both were squeezed into one instrument (a stacked column per
 * day), and the split was only legible through a legend of five unlabelled
 * dots: at 3px of colour per activity, per day, nobody could read it.
 *
 * Segments rather than a single metric, because the whole point is the split:
 * each activity takes the width its cost earns, and hovering any stick names it
 * with its own figure and its share of the month. Values go in as USD so the
 * tooltip reads in the same money as the headline.
 *
 * A client component for one reason — the gauge takes a formatter function, and
 * a function is not serialisable across the server boundary. The same reason
 * `sending-capacity-card.tsx` is one.
 */
export function AiSpendActivityGauge({ summary }: { summary: AiSpendSummary }) {
  const segments = aiSpendActivityRows(summary)
    .filter((row) => row.costUsd > 0)
    .map((row) => ({
      id: row.activity,
      label: row.label,
      value: row.costUsd,
      color: row.colour,
    }));

  // Nothing priced means no share to draw — the card says so in words instead
  // of the gauge drawing an empty track that reads as "all zeroes".
  if (segments.length === 0) return null;

  return (
    <HorizontalStickGauge
      segments={segments}
      ariaLabel="What this month's AI spend went on"
      valueFormatter={formatUsd}
    />
  );
}

export default AiSpendActivityGauge;
