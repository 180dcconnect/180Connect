import {
  interpolatePriorityColor,
  PRIORITY_CX as CX,
  PRIORITY_CY as CY,
  PRIORITY_HUB_FILL,
  PRIORITY_ZONE_COLOURS,
  PRIORITY_ZONE_LABELS,
  priorityAngleAt as angleAt,
  priorityPointAt as pointAt,
  priorityRound as round,
  priorityZoneOf,
} from "@/lib/scoring/priority-scale.ts";

/**
 * The record header's instrument gauge, in miniature, for the dashboard's
 * opportunity cards.
 *
 * The same scale drawn the same way: a 250° comb opening at the bottom, the
 * same brick → amber → green gradient, the same six zones, the same tapered
 * needle on the same hub. Colours, zone cuts and geometry all come from
 * `src/lib/scoring/priority-scale.ts`, so a score that sits in "High" on the
 * record page sits in High, in that exact green, here too — one instrument,
 * read at two sizes, never two systems that drift.
 *
 * What the miniature drops is everything that needs room or a pointer: 24
 * ticks instead of 60, no scale numbers, no per-zone hover explanations. Six
 * interactive dials on one dashboard would be noise; the record page is where
 * someone goes to interrogate a number. That also keeps this a plain server
 * component — no "use client", no motion, no JavaScript shipped per card.
 */

/** The comb: 24 radial bars. Every zone cut still lands on a gap between bars. */
const TOTAL_TICKS = 24;
const R_TICK_INNER = 74;
const R_TICK_OUTER = 94;
const TICK_WIDTH = 5.2;

/** The needle stops short of the comb; its tail clears the hub. */
const NEEDLE_TIP_R = 62;
const NEEDLE_TAIL_R = 13;
const NEEDLE_HALF_W = 5;

const TICKS = Array.from({ length: TOTAL_TICKS }, (_, index) => {
  const centre = (index + 0.5) / TOTAL_TICKS;
  const base = pointAt(centre, R_TICK_INNER);
  const tip = pointAt(centre, R_TICK_OUTER);
  return {
    index,
    colour: interpolatePriorityColor(centre),
    x1: base.x,
    y1: base.y,
    x2: tip.x,
    y2: tip.y,
  };
});

/** The needle as a tapered wedge, exactly as the record header draws it. */
function needlePoints(fraction: number): string {
  const angle = angleAt(fraction);
  const px = -Math.sin(angle) * NEEDLE_HALF_W;
  const py = Math.cos(angle) * NEEDLE_HALF_W;
  const tip = pointAt(fraction, NEEDLE_TIP_R);
  const tail = pointAt(fraction, -NEEDLE_TAIL_R);
  return [
    `${round(tail.x + px)},${round(tail.y + py)}`,
    `${round(tip.x)},${round(tip.y)}`,
    `${round(tail.x - px)},${round(tail.y - py)}`,
  ].join(" ");
}

export function PriorityMiniDial({
  score,
  displayScore,
}: {
  /** Persisted score, 0–1. Null for a row with no score. */
  score: number | null;
  /**
   * That reading as the card prints it — the same 0–1 figure to one decimal
   * (`0.9`), so the number under the instrument and the needle above it are
   * reading the same scale. Null for a row with no score.
   */
  displayScore: string | null;
}) {
  const clamped = score === null ? null : Math.max(0, Math.min(1, score));
  const zone = clamped === null ? null : priorityZoneOf(clamped);
  const zoneLabel = zone ? PRIORITY_ZONE_LABELS[zone] : "Not scored yet";

  return (
    <span
      role="img"
      aria-label={
        clamped === null
          ? "Not scored yet"
          : `Priority score ${displayScore} out of 1, ${zoneLabel.toLowerCase()} priority`
      }
      className="flex shrink-0 flex-col items-center"
    >
      <svg
        viewBox="2 2 196 160"
        aria-hidden="true"
        className="block h-auto w-[78px] select-none"
      >
        <g
          strokeWidth={TICK_WIDTH}
          strokeLinecap="round"
          opacity={clamped === null ? 0.3 : 1}
        >
          {TICKS.map((tick) => (
            <line
              key={tick.index}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              stroke={tick.colour}
            />
          ))}
        </g>

        {clamped === null ? (
          <circle cx={CX} cy={CY} r={9} fill={PRIORITY_HUB_FILL} />
        ) : (
          <g className="text-ink">
            <polygon points={needlePoints(clamped)} fill="currentColor" />
            <circle cx={CX} cy={CY} r={11} fill={PRIORITY_HUB_FILL} />
            <circle cx={CX} cy={CY} r={6} fill="currentColor" />
          </g>
        )}
      </svg>

      {/* The reading, under the instrument: the score on its own scale, then
          the zone's own word in the zone's own ink — the record header's
          readout, shortened to what fits a card. The needle above is already
          pointing at a fraction of the dial's 1, so the readout says `/1`
          rather than restating that number as a percentage of 100. */}
      <span className="mt-0.5 block font-body text-[19px] leading-none font-bold tracking-[-0.02em] text-ink tabular-nums">
        {displayScore === null ? "—" : displayScore}
        <span className="ml-0.5 text-[10px] font-semibold text-faint">/1</span>
      </span>
      <span
        className="mt-1 block text-center font-body text-[10px] leading-[1.2] font-bold tracking-[0.02em]"
        style={{ color: zone ? PRIORITY_ZONE_COLOURS[zone] : undefined }}
      >
        {zoneLabel}
      </span>
    </span>
  );
}

export default PriorityMiniDial;
