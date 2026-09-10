/**
 * Shared face rating data, colors, and SVG mouth path curves.
 * Extracted from Spectrum UI FaceRating to be shared across the dialog,
 * feedback admin page, and feed components without JSX dependencies.
 */

export const RATING_LEVELS = [1, 2, 3, 4, 5] as const;

/** rose-500, orange-500, amber-400, lime-500, emerald-500 */
export const RATING_COLORS = [
  "#f43f5e",
  "#f97316",
  "#fbbf24",
  "#84cc16",
  "#10b981",
] as const;

/** neutral-400 — face color while unrated or neutral */
export const RATING_UNSET_COLOR = "#a3a3a3";

/** Mouth control-point Y per level: deep frown → flat → big smile */
export const MOUTH_CONTROL_Y = [34, 41, 47, 54, 61] as const;

/** Mouth corner Y per level: corners droop when upset, lift when delighted */
export const MOUTH_CORNER_Y = [49.5, 48, 47, 46, 44.5] as const;

/** Eye squash per level: narrowed when upset, wide open when amazed */
export const EYE_SCALE_Y = [0.45, 0.6, 0.9, 1, 1.25] as const;

/**
 * Builds the SVG quadratic curve path `d` for a given mood level (1–5).
 * Levels outside 1–5 are clamped to the valid range.
 */
export function getMouthPath(level: number): string {
  const clamped = Math.max(1, Math.min(5, Math.round(level || 3)));
  const corner = MOUTH_CORNER_Y[clamped - 1];
  const control = MOUTH_CONTROL_Y[clamped - 1];
  return `M 22 ${corner} Q 36 ${control} 50 ${corner}`;
}
