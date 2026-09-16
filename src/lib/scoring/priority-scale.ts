/**
 * The priority scale's visual language, once.
 *
 * The record header's instrument gauge (`src/app/(app)/clients/[id]/
 * priority-dial.tsx`) draws a 250° comb of ticks in a continuous
 * brick → amber → green gradient, divided into six zones. The dashboard
 * opportunity cards draw the same comb in miniature. Both read from here so
 * the colours and zone cuts cannot drift apart into two systems: a score
 * sits in the same zone with the same colour everywhere it is drawn.
 *
 * Server-safe and dependency-free (no React, no motion) so server components
 * and `node --test` can both use it. Relative, not "@/lib/...": this module
 * runs under `node --test`, which does not read Next's tsconfig path aliases.
 */

export type PriorityZoneId =
  | "critical_low"
  | "low"
  | "low_medium"
  | "high_medium"
  | "high"
  | "extremely_high";

/** Gradient stops behind the comb, in scale order (fraction 0–1). */
export type PriorityColorStop = {
  fraction: number;
  r: number;
  g: number;
  b: number;
};

export const PRIORITY_COLOR_STOPS: readonly PriorityColorStop[] = [
  { fraction: 0.0, r: 140, g: 58, b: 43 },
  { fraction: 0.2, r: 176, g: 88, b: 64 },
  { fraction: 0.4, r: 217, g: 125, b: 56 },
  { fraction: 0.55, r: 220, g: 165, b: 36 },
  { fraction: 0.7, r: 125, g: 155, b: 74 },
  { fraction: 0.85, r: 53, g: 107, b: 88 },
  { fraction: 1.0, r: 32, g: 74, b: 62 },
];

/** The scale span each zone owns. */
export const PRIORITY_ZONE_SPANS: Record<PriorityZoneId, { from: number; to: number }> = {
  critical_low: { from: 0, to: 0.2 },
  low: { from: 0.2, to: 0.4 },
  low_medium: { from: 0.4, to: 0.55 },
  high_medium: { from: 0.55, to: 0.7 },
  high: { from: 0.7, to: 0.85 },
  extremely_high: { from: 0.85, to: 1.0 },
};

/** The one colour per zone, for readouts and needles drawn in zone ink. */
export const PRIORITY_ZONE_COLOURS: Record<PriorityZoneId, string> = {
  critical_low: "#8C3A2B",
  low: "#B05840",
  low_medium: "#D97D38",
  high_medium: "#DCA524",
  high: "#356B58",
  extremely_high: "#204A3E",
};

/** The zone a fraction of the scale belongs to. */
export function priorityZoneOf(fraction: number): PriorityZoneId {
  if (fraction < 0.2) return "critical_low";
  if (fraction < 0.4) return "low";
  if (fraction < 0.55) return "low_medium";
  if (fraction < 0.7) return "high_medium";
  if (fraction < 0.85) return "high";
  return "extremely_high";
}

/** The comb's continuous gradient, interpolated between the stops above. */
export function interpolatePriorityColor(fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction));
  let lower = PRIORITY_COLOR_STOPS[0];
  let upper = PRIORITY_COLOR_STOPS[PRIORITY_COLOR_STOPS.length - 1];

  for (let i = 0; i < PRIORITY_COLOR_STOPS.length - 1; i++) {
    if (f >= PRIORITY_COLOR_STOPS[i].fraction && f <= PRIORITY_COLOR_STOPS[i + 1].fraction) {
      lower = PRIORITY_COLOR_STOPS[i];
      upper = PRIORITY_COLOR_STOPS[i + 1];
      break;
    }
  }

  const span = upper.fraction - lower.fraction;
  const t = span <= 0 ? 0 : (f - lower.fraction) / span;

  const r = Math.round(lower.r + t * (upper.r - lower.r));
  const g = Math.round(lower.g + t * (upper.g - lower.g));
  const b = Math.round(lower.b + t * (upper.b - lower.b));

  return `rgb(${r}, ${g}, ${b})`;
}

/** The hub's soft seat, behind the needle's pivot. */
export const PRIORITY_HUB_FILL = "#e2e5ea";

/** The one word per zone, as the record header's readout prints it. */
export const PRIORITY_ZONE_LABELS: Record<PriorityZoneId, string> = {
  critical_low: "Critical Low",
  low: "Low",
  low_medium: "Low Medium",
  high_medium: "High Medium",
  high: "High",
  extremely_high: "Extremely High",
};

/**
 * Comb geometry both gauges share: a 250° sweep opening at the bottom —
 * zero at seven o'clock, one at five o'clock — so the arc is the territory
 * and the needle is the reading. The record header draws 60 ticks and scale
 * labels on it; the dashboard miniature draws fewer ticks and no labels.
 */
export const PRIORITY_START_ANGLE_DEG = 145;
export const PRIORITY_SWEEP_DEG = 250;
export const PRIORITY_CX = 100;
export const PRIORITY_CY = 100;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Thousandth-rounding shared with the gauges, so needles land exactly. */
export const priorityRound = round3;

export function priorityAngleAt(fraction: number): number {
  return ((PRIORITY_START_ANGLE_DEG + fraction * PRIORITY_SWEEP_DEG) * Math.PI) / 180;
}

export function priorityPointAt(
  fraction: number,
  radius: number,
): { x: number; y: number } {
  const angle = priorityAngleAt(fraction);
  return {
    x: round3(PRIORITY_CX + radius * Math.cos(angle)),
    y: round3(PRIORITY_CY + radius * Math.sin(angle)),
  };
}
