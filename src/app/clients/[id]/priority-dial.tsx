"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { ScoreFactorsRecord } from "@/lib/scoring/persist-latest-score.ts";

/**
 * The priority score as a ring, in the record header where the bare number used
 * to sit.
 *
 * **The unearned part of the ring is not drawn.** No grey track, no faded
 * remainder — a score of 0.50 draws half a circle and stops. That is the whole
 * idea: the eye closes the circle on its own, so the gap reads as "how much is
 * missing" without a single label. A greyed-out track would have said the same
 * thing in a weaker voice, because a drawn thing is a present thing.
 *
 * **The ring is coloured by band, not by brand.** A number on its own does not
 * say whether it is good news — 0.54 could be anything until you know the scale
 * and where the thresholds sit. So the whole ring takes the band's hue: green at
 * high, amber at medium, slate at low, the same three states `Pill` already uses
 * everywhere else on this record. Reading the word is now the second way you
 * learn the answer, not the only one.
 *
 * Within that hue, each parameter's run is a step lighter than the one before,
 * so the split stays legible without introducing five unrelated colours that
 * would compete with the band signal. The ramp is generated from the band's base
 * colour rather than hand-picked, which is what keeps the three bands
 * structurally identical.
 *
 * Hovering a run makes every other run vanish — the same rule the unearned
 * remainder already obeys — and a tooltip names it and its contribution.
 *
 * A parameter with no usable data (the engine's explicit 0.5) still occupies
 * ring, because it genuinely contributed weight × 0.5 to the score, but it is
 * drawn on a grey ramp rather than the band's, so a glance separates evidence
 * from padding before any label is read.
 *
 * Hence the coverage line under the ring. A factor with no data is not dropped
 * from the average — it is padded to 0.5, which is a deliberate shrinkage that
 * stops one known parameter swinging a sparse record (drop-and-renormalise
 * would put a client we know nothing about but have not yet contacted at 0.70,
 * top band, on that fact alone). The cost of the padding is that the score
 * cannot say how much of itself is evidence, so the count says it instead: two
 * clients both on 0.54 are not the same claim if one is 5-of-5 and the other is
 * 1-of-5.
 *
 * Ticks are butt-capped: round caps on a 20px stick add a half-stroke-width dome at
 * each end, which at this radius reads as a curve rather than a mark.
 */

const FACTOR_ORDER: {
  key: keyof ScoreFactorsRecord["factors"];
  label: string;
}[] = [
  { key: "sector", label: "Sector" },
  { key: "geography", label: "Geography" },
  { key: "size", label: "Size" },
  { key: "partnershipHistory", label: "Partnership history" },
  { key: "previousContact", label: "Previous contact" },
];

type FactorKey = (typeof FACTOR_ORDER)[number]["key"];

/**
 * The band's base hue, and the ink its label is set in. `--go`, `--hold` and
 * `--dim` — the same three states `Pill` reports with, so a green ring and a
 * green pill mean the same thing on this page.
 */
const BAND_STYLE: Record<
  string,
  { base: string; text: string; label: string }
> = {
  high: { base: "#3d7a2e", text: "text-go", label: "High" },
  medium: { base: "#8a5a00", text: "text-hold", label: "Medium" },
  low: { base: "#667080", text: "text-dim", label: "Low" },
};

/** What an unbanded (but scored) row falls back to. */
const FALLBACK_BAND = { base: "#35589b", text: "text-lead", label: "" };

/** A parameter with no usable data never wears the band's colour. */
const NEUTRAL_BASE = "#9aa2ae";

/**
 * Mixes a hex colour toward white. Each successive run is one step lighter, so
 * five runs read as five steps of one material rather than five materials.
 */
function lighten(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const mix = (channel: number) =>
    Math.round(channel + (255 - channel) * amount);
  const r = mix((value >> 16) & 0xff);
  const g = mix((value >> 8) & 0xff);
  const b = mix(value & 0xff);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Step per run. Five runs span base → 60% toward white. */
const SHADE_STEP = 0.15;

// A closed ring, starting at twelve o'clock and running clockwise.
const TOTAL_TICKS = 72;
const START_ANGLE_DEG = -90;
const R_INNER = 72;
const R_OUTER = 92;

export function PriorityDial({
  score,
  band,
  factors,
}: {
  score: number | null;
  band: string | null;
  factors: ScoreFactorsRecord | null;
}) {
  const [hovered, setHovered] = useState<FactorKey | null>(null);
  const bandStyle = (band && BAND_STYLE[band]) || FALLBACK_BAND;

  const runs = useMemo(() => {
    if (score === null) return [];
    if (!factors) {
      // Scored, but without a per-parameter breakdown on the row: draw the
      // score as one undivided run rather than nothing.
      return [
        {
          key: "sector" as FactorKey,
          label: "Priority score",
          colour: bandStyle.base,
          neutral: false,
          percent: 100,
          start: 0,
          end: score,
        },
      ];
    }

    const weighted = FACTOR_ORDER.map((factor) => ({
      ...factor,
      neutral: factors.factors[factor.key] === 0.5,
      value:
        Math.max(0, Math.min(1, factors.factors[factor.key])) *
        Math.max(0, factors.weights[factor.key]),
    }));
    const total = weighted.reduce((sum, part) => sum + part.value, 0);

    const out = [];
    let cursor = 0;
    // Two ramps, stepped independently. Sharing one counter would hand the
    // palest shade to whichever real reading happened to come last in the
    // order — on a record with one covered parameter, that means the only
    // evidence on the ring is also the faintest thing on it.
    let bandStep = 0;
    let neutralStep = 0;
    for (const part of weighted) {
      const share = total === 0 ? 0 : part.value / total;
      const start = cursor;
      cursor = start + share * score;
      const shade = part.neutral
        ? lighten(NEUTRAL_BASE, neutralStep * SHADE_STEP)
        : lighten(bandStyle.base, bandStep * SHADE_STEP);
      if (part.neutral) neutralStep += 1;
      else bandStep += 1;
      out.push({
        key: part.key,
        label: part.label,
        colour: shade,
        neutral: part.neutral,
        percent: share * 100,
        start,
        end: cursor,
      });
    }
    return out;
  }, [score, factors, bandStyle.base]);

  // Only ticks inside a run exist. Past the score there is nothing to render —
  // not a faint tick, not a track.
  const ticks = useMemo(() => {
    const out = [];
    for (let index = 0; index < TOTAL_TICKS; index += 1) {
      const fraction = index / TOTAL_TICKS;
      const run = runs.find(
        (candidate) => fraction >= candidate.start && fraction < candidate.end,
      );
      if (!run) continue;
      const angle = ((START_ANGLE_DEG + fraction * 360) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      out.push({
        index,
        runKey: run.key,
        colour: run.colour,
        x1: 100 + R_INNER * cos,
        y1: 100 + R_INNER * sin,
        x2: 100 + R_OUTER * cos,
        y2: 100 + R_OUTER * sin,
      });
    }
    return out;
  }, [runs]);

  const bandLabel = band ? (BAND_STYLE[band]?.label ?? band) : null;
  const activeRun = hovered ? runs.find((run) => run.key === hovered) : null;

  // 0.5 survives the jsonb round trip exactly (binary-representable), so
  // equality against the engine's no-data constant is safe.
  const covered = factors
    ? FACTOR_ORDER.filter((factor) => factors.factors[factor.key] !== 0.5)
        .length
    : null;

  return (
    <div className="flex min-h-0 shrink-0 flex-col items-center justify-center gap-1.5">
      <div
        className="relative aspect-square w-[180px] max-w-full @container"
        role="img"
        aria-label={
          score === null
            ? "Priority score: not scored yet"
            : `Priority score ${score.toFixed(2)} out of 1.00${
                bandLabel ? `, ${bandLabel.toLowerCase()} priority` : ""
              }${
                covered === null
                  ? ""
                  : `, from ${covered} of ${FACTOR_ORDER.length} parameters with data`
              }. Breakdown by parameter is on the Overview tab.`
        }
      >
        <svg viewBox="0 0 200 200" className="size-full select-none">
          {ticks.map((tick) => {
            const visible = hovered === null || tick.runKey === hovered;
            return (
              <g key={tick.index}>
                <line
                  x1={tick.x1}
                  y1={tick.y1}
                  x2={tick.x2}
                  y2={tick.y2}
                  stroke={tick.colour}
                  strokeWidth={4}
                  strokeLinecap="butt"
                  className="transition-opacity duration-150"
                  style={{ opacity: visible ? 1 : 0 }}
                />
                {/* A fatter invisible stick so a 4px mark is still easy to
                  point at; it is what carries the hover, not the visible one. */}
                <line
                  x1={tick.x1}
                  y1={tick.y1}
                  x2={tick.x2}
                  y2={tick.y2}
                  stroke="transparent"
                  strokeWidth={15}
                  onPointerEnter={() => setHovered(tick.runKey)}
                  onPointerLeave={() => setHovered(null)}
                />
              </g>
            );
          })}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {score === null ? (
            <>
              <span className="font-mono text-[19cqw] leading-none font-medium text-faint tabular-nums">
                —
              </span>
              <span className="mt-2 max-w-[6.5rem] text-[6.5cqw] leading-[1.35] font-medium text-faint">
                Not scored yet
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-[22.5cqw] leading-none font-medium tracking-[-0.03em] text-ink tabular-nums">
                {score.toFixed(2)}
              </span>
              {bandLabel && (
                <span
                  className={`mt-[3cqw] text-[6.8cqw] font-semibold tracking-[-0.01em] ${bandStyle.text}`}
                >
                  {bandLabel} priority
                </span>
              )}
            </>
          )}
        </div>

        <AnimatePresence>
          {activeRun && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded-inset bg-ink px-2.5 py-1.5 text-center shadow-lg"
            >
              <span className="flex items-center gap-1.5 text-[11.5px] font-semibold whitespace-nowrap text-white">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: activeRun.colour }}
                />
                {activeRun.label}
              </span>
              <span className="mt-0.5 block text-[11px] whitespace-nowrap text-white/70">
                {activeRun.neutral
                  ? `No data — counts as ${activeRun.percent.toFixed(0)}%`
                  : `Contributes ${activeRun.percent.toFixed(0)}% of the score`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {covered !== null && (
        <p className="text-[11.5px] leading-[1.4] font-medium text-faint">
          {covered} of {FACTOR_ORDER.length} parameters have data
        </p>
      )}
    </div>
  );
}
