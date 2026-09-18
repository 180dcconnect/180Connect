"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { ScoreFactorsRecord } from "@/lib/scoring/persist-latest-score.ts";

/**
 * The priority score as an instrument gauge, in the record header.
 *
 * **The whole scale is always drawn.** A 250° sweep opening at the bottom —
 * zero at seven o'clock, one at five o'clock — so the arc is the territory and
 * the needle is the reading.
 *
 * **Continuous gradient across 60 radial bars, divided into 6 granular tiers:**
 * - Critical Low: 0.00 to 0.20 (Deep Sankey Crimson #8C3A2B)
 * - Low: 0.20 to 0.40 (Burnt Orange #B05840)
 * - Low Medium: 0.40 to 0.55 (Warm Amber #D97D38)
 * - High Medium: 0.55 to 0.70 (Golden Yellow #DCA524)
 * - High: 0.70 to 0.85 (Jade Forest Green #356B58)
 * - Extremely High: 0.85 to 1.00 (Deep Emerald #204A3E)
 *
 * The colors follow the financial Sankey palette (warm brick/orange for low,
 * rich emerald/jade for high, with a smooth yellow/amber bridge).
 *
 * 60 ticks puts every threshold (0.20, 0.40, 0.55, 0.70, 0.85) exactly on a
 * gap between bars so the scale labels and color changes align seamlessly.
 */

const FACTOR_ORDER: {
  key: keyof ScoreFactorsRecord["factors"];
}[] = [
  { key: "sector" },
  { key: "geography" },
  { key: "size" },
  { key: "partnershipHistory" },
  { key: "previousContact" },
];

export type PriorityZoneId =
  | "critical_low"
  | "low"
  | "low_medium"
  | "high_medium"
  | "high"
  | "extremely_high";

/** Gradient interpolation stops inspired by the Financial Sankey ramps. */
interface ColorStop {
  fraction: number;
  r: number;
  g: number;
  b: number;
}

const COLOR_STOPS: ColorStop[] = [
  { fraction: 0.00, r: 140, g: 58, b: 43 },   // #8C3A2B - Sankey OUT_RAMP[0] Deep Terracotta
  { fraction: 0.20, r: 176, g: 88, b: 64 },   // #B05840 - Sankey OUT_RAMP[1] Burnt Orange
  { fraction: 0.40, r: 217, g: 125, b: 56 },  // #D97D38 - Warm Amber-Orange
  { fraction: 0.55, r: 220, g: 165, b: 36 },  // #DCA524 - Golden Amber / Yellow
  { fraction: 0.70, r: 125, g: 155, b: 74 },  // #7D9B4A - Olive / Lime-Green
  { fraction: 0.85, r: 53, g: 107, b: 88 },   // #356B58 - Sankey IN_RAMP[1] Jade Green
  { fraction: 1.00, r: 32, g: 74, b: 62 },    // #204A3E - Sankey IN_RAMP[0] Deep Emerald Green
];

function interpolateColor(fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction));
  let lower = COLOR_STOPS[0];
  let upper = COLOR_STOPS[COLOR_STOPS.length - 1];

  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (f >= COLOR_STOPS[i].fraction && f <= COLOR_STOPS[i + 1].fraction) {
      lower = COLOR_STOPS[i];
      upper = COLOR_STOPS[i + 1];
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

/** The zone a fraction of the scale belongs to. */
export function zoneOf(fraction: number): PriorityZoneId {
  if (fraction < 0.20) return "critical_low";
  if (fraction < 0.40) return "low";
  if (fraction < 0.55) return "low_medium";
  if (fraction < 0.70) return "high_medium";
  if (fraction < 0.85) return "high";
  return "extremely_high";
}

/** The band's ink and label for its readout row. */
const BAND_STYLE: Record<PriorityZoneId, { text: string; label: string; colour: string }> = {
  critical_low: { text: "text-[#8C3A2B]", label: "Critical Low", colour: "#8C3A2B" },
  low: { text: "text-[#B05840]", label: "Low", colour: "#B05840" },
  low_medium: { text: "text-[#D97D38]", label: "Low Medium", colour: "#D97D38" },
  high_medium: { text: "text-[#C08416]", label: "High Medium", colour: "#DCA524" },
  high: { text: "text-[#356B58]", label: "High", colour: "#356B58" },
  extremely_high: { text: "text-[#204A3E]", label: "Extremely High", colour: "#204A3E" },
};

/** What an unbanded (but scored) row falls back to. */
const FALLBACK_BAND = { text: "text-ink", label: "—", colour: "#8b94a1" };

/** The hub's soft seat, behind the needle's pivot. */
const HUB_FILL = "#e2e5ea";

// Geometry. 250° of sweep leaves a 110° gap at the bottom for the legend to
// sit under without the comb's ends crowding it.
const START_ANGLE_DEG = 145;
const SWEEP_DEG = 250;
const CX = 100;
const CY = 100;
/** The comb: 60 radial bars between these two radii. */
const R_TICK_INNER = 72;
const R_TICK_OUTER = 94;
const TICK_WIDTH = 3.4;
const TOTAL_TICKS = 60;

/**
 * The hover target: one fat transparent arc per zone, centred on the comb and
 * wide enough to swallow it.
 */
const R_HIT = (R_TICK_INNER + R_TICK_OUTER) / 2;
const HIT_WIDTH = R_TICK_OUTER - R_TICK_INNER + 8;

/** Scale labels sit just outside the comb. */
const R_LABEL = 107;
/** The needle stops well short of the comb; its tail clears the hub. */
const NEEDLE_TIP_R = 62;
const NEEDLE_TAIL_R = 15;
/** Half-width of the needle where it leaves the hub. */
const NEEDLE_HALF_W = 4;

/** Where the scale is marked: 0, 0.20, 0.40, 0.55, 0.70, 0.85, 1.00. */
const SCALE_MARKS = [
  { fraction: 0, label: "0" },
  { fraction: 0.20, label: "0.20" },
  { fraction: 0.40, label: "0.40" },
  { fraction: 0.55, label: "0.55" },
  { fraction: 0.70, label: "0.70" },
  { fraction: 0.85, label: "0.85" },
  { fraction: 1, label: "1.00" },
];

/**
 * What each zone means, in the reader's terms. Written to answer the question
 * the colours provoke and clarify scoring factors and conversion readiness.
 */
const ZONE_NOTES: {
  id: PriorityZoneId;
  label: string;
  range: string;
  colour: string;
  text: string;
  body: string;
  reach: string;
}[] = [
  {
    id: "critical_low",
    label: "Critical Low",
    range: "under 0.20",
    colour: "#8C3A2B",
    text: "text-[#8C3A2B]",
    body:
      "Severe engagement hurdles or non-target profile: usually explicit opt-outs, inactive registry status, or negligible operating capacity. Kept on record, but requires a direct outreach reset before re-engaging.",
    reach:
      "Rarely assigned unless an organisation explicitly opts out or has zero operating filings.",
  },
  {
    id: "low",
    label: "Low",
    range: "0.20 to 0.40",
    colour: "#B05840",
    text: "text-[#B05840]",
    body:
      "Not a bad organisation — a later one. Typically reflects unengaged outreach (unanswered follow-ups), modest filed income, or non-priority sector alignment. New activity, fresh filings, or updated contact data will lift this score.",
    reach:
      "Scores between 0.33 and 0.40 under current factors without active engagement.",
  },
  {
    id: "low_medium",
    label: "Low Medium",
    range: "0.40 to 0.55",
    colour: "#D97D38",
    text: "text-[#D97D38]",
    body:
      "Baseline candidate profile with partial data: default neutral scores on missing fields (e.g. unknown sector or size) often keep clients here. Indicates a viable client that simply needs more recorded intelligence before prioritizing.",
    reach:
      "Where un-enriched clients default (0.50 neutral baseline).",
  },
  {
    id: "high_medium",
    label: "High Medium",
    range: "0.55 to 0.70",
    colour: "#DCA524",
    text: "text-[#C08416]",
    body:
      "Solid strategic fit with positive indicators: moderate verified income, relevant sector classification, or warm previous contact history. Strong candidate for outreach once top-tier queues are addressed.",
    reach:
      "Achieved when at least two factors show positive alignment.",
  },
  {
    id: "high",
    label: "High",
    range: "0.70 to 0.85",
    colour: "#356B58",
    text: "text-[#356B58]",
    body:
      "Prime outreach candidate: confirmed priority sector, substantial charitable income, matched grant funding history, or proven engagement track record. High conversion potential.",
    reach:
      "Top 15% of active pipeline candidates under current scoring rules.",
  },
  {
    id: "extremely_high",
    label: "Extremely High",
    range: "0.85 and up",
    colour: "#204A3E",
    text: "text-[#204A3E]",
    body:
      "Exceptional alignment across all dimensions: top-tier income scale, multiple verified grant awards, priority sector focus, and active positive stakeholder relationships. Immediate outreach priority.",
    reach:
      "The highest possible priority rating in the scout model.",
  },
];

/** The scale span each zone owns, for its hover target. */
const ZONE_SPANS: Record<PriorityZoneId, { from: number; to: number }> = {
  critical_low: { from: 0, to: 0.20 },
  low: { from: 0.20, to: 0.40 },
  low_medium: { from: 0.40, to: 0.55 },
  high_medium: { from: 0.55, to: 0.70 },
  high: { from: 0.70, to: 0.85 },
  extremely_high: { from: 0.85, to: 1.00 },
};

const round = (value: number) => Math.round(value * 1000) / 1000;

function angleAt(fraction: number): number {
  return ((START_ANGLE_DEG + fraction * SWEEP_DEG) * Math.PI) / 180;
}

function pointAt(fraction: number, radius: number): { x: number; y: number } {
  const angle = angleAt(fraction);
  return {
    x: round(CX + radius * Math.cos(angle)),
    y: round(CY + radius * Math.sin(angle)),
  };
}

/** An arc along the scale, as a stroke-able path. Used for the hover targets. */
function arcPath(fromFraction: number, toFraction: number, radius: number): string {
  const start = pointAt(fromFraction, radius);
  const end = pointAt(toFraction, radius);
  const largeArc = (toFraction - fromFraction) * SWEEP_DEG > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

/**
 * Which side of the dial a label sits on, so the text hangs off the arc rather
 * than sitting on top of it.
 */
function labelAnchor(fraction: number): "start" | "middle" | "end" {
  const cos = Math.cos(angleAt(fraction));
  if (cos < -0.25) return "end";
  if (cos > 0.25) return "start";
  return "middle";
}

interface TooltipPlacement {
  style: React.CSSProperties;
  arrowStyle: React.CSSProperties;
}

function computeTooltipPosition(
  cursor: { x: number; y: number } | null,
  containerRect: DOMRect | null,
  zone: PriorityZoneId,
): TooltipPlacement {
  const TOOLTIP_W = 220;
  const TOOLTIP_H = 200;

  let cy = cursor?.y ?? 80;

  if (!cursor) {
    const span = ZONE_SPANS[zone];
    const midFraction = (span.from + span.to) / 2;
    const pt = pointAt(midFraction, R_HIT);
    const scale = ((containerRect?.width ?? 250) * (188 / 260)) / 188;
    cy = (pt.y + 12) * scale;
  }

  const spaceLeft = containerRect ? containerRect.left : 400;
  const spaceRight =
    containerRect && typeof window !== "undefined"
      ? window.innerWidth - containerRect.right
      : 200;

  if (spaceLeft >= TOOLTIP_W + 16) {
    // Sits entirely to the LEFT of the gauge container — zero overlap with gauge
    const top = Math.max(0, Math.min(80, cy - 60));
    const arrowTop = Math.max(16, Math.min(TOOLTIP_H - 16, cy - top));
    return {
      style: {
        right: "calc(100% + 14px)",
        top,
      },
      arrowStyle: {
        right: -5,
        top: arrowTop,
        transform: "translateY(-50%) rotate(45deg)",
      },
    };
  } else if (spaceRight >= TOOLTIP_W + 16) {
    // Sits entirely to the RIGHT of the gauge container
    const top = Math.max(0, Math.min(80, cy - 60));
    const arrowTop = Math.max(16, Math.min(TOOLTIP_H - 16, cy - top));
    return {
      style: {
        left: "calc(100% + 14px)",
        top,
      },
      arrowStyle: {
        left: -5,
        top: arrowTop,
        transform: "translateY(-50%) rotate(45deg)",
      },
    };
  } else {
    // Mobile fallback: sits below the gauge
    const cx = cursor?.x ?? 110;
    const arrowLeft = Math.max(16, Math.min(TOOLTIP_W - 16, cx));
    return {
      style: {
        top: "calc(100% + 12px)",
        left: "50%",
        transform: "translateX(-50%)",
      },
      arrowStyle: {
        top: -5,
        left: arrowLeft,
        transform: "translateX(-50%) rotate(45deg)",
      },
    };
  }
}

export function PriorityDial({
  score,
  band,
  factors,
}: {
  score: number | null;
  band: string | null;
  factors: ScoreFactorsRecord | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);
  const [hoveredZone, setHoveredZone] = useState<PriorityZoneId | null>(null);
  // Pinning makes the explanation reachable on a touch screen.
  const [pinnedZone, setPinnedZone] = useState<PriorityZoneId | null>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setContainerRect(rect);
    setCursor({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const clamped = score === null ? null : Math.max(0, Math.min(1, score));

  const resolvedZone = clamped === null ? null : zoneOf(clamped);
  const bandStyle = resolvedZone ? BAND_STYLE[resolvedZone] : FALLBACK_BAND;
  const bandLabel = resolvedZone ? BAND_STYLE[resolvedZone].label : (band ?? null);

  // The comb: 60 radial ticks with smooth continuous gradient interpolation.
  const ticks = useMemo(() => {
    const out: {
      index: number;
      zone: PriorityZoneId;
      colour: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }[] = [];
    for (let index = 0; index < TOTAL_TICKS; index += 1) {
      const centre = (index + 0.5) / TOTAL_TICKS;
      const base = pointAt(centre, R_TICK_INNER);
      const tip = pointAt(centre, R_TICK_OUTER);
      out.push({
        index,
        zone: zoneOf(centre),
        colour: interpolateColor(centre),
        x1: base.x,
        y1: base.y,
        x2: tip.x,
        y2: tip.y,
      });
    }
    return out;
  }, []);

  // The needle as a tapered wedge.
  const needle = useMemo(() => {
    if (clamped === null) return null;
    const angle = angleAt(clamped);
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    // Perpendicular to the needle's own axis.
    const px = -ny * NEEDLE_HALF_W;
    const py = nx * NEEDLE_HALF_W;
    const tip = pointAt(clamped, NEEDLE_TIP_R);
    const tail = pointAt(clamped, -NEEDLE_TAIL_R);
    return [
      `${round(tail.x + px)},${round(tail.y + py)}`,
      `${round(tip.x)},${round(tip.y)}`,
      `${round(tail.x - px)},${round(tail.y - py)}`,
    ].join(" ");
  }, [clamped]);

  const activeZone = hoveredZone ?? pinnedZone;
  const activeNote =
    activeZone === null
      ? null
      : (ZONE_NOTES.find((zone) => zone.id === activeZone) ?? null);

  const tooltipPos = useMemo(() => {
    if (!activeZone) return null;
    return computeTooltipPosition(cursor, containerRect, activeZone);
  }, [cursor, containerRect, activeZone]);

  // 0.5 survives the jsonb round trip exactly (binary-representable), so
  // equality against the engine's no-data constant is safe.
  const covered = factors
    ? FACTOR_ORDER.filter((factor) => factors.factors[factor.key] !== 0.5)
        .length
    : null;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative flex min-h-0 w-[210px] sm:w-[230px] md:w-[250px] lg:w-[275px] xl:w-[290px] max-w-full shrink-0 flex-col items-center"
    >
      {/* The reading in words for screen readers. */}
      <p className="sr-only">
        {score === null
          ? "Priority score: not scored yet."
          : `Priority score ${score.toFixed(2)} out of 1.00${
              bandLabel ? `, ${bandLabel.toLowerCase()} priority` : ""
            }${
              covered === null
                ? ""
                : `, from ${covered} of ${FACTOR_ORDER.length} parameters with data`
            }. Breakdown by parameter is on the Overview tab.`}
      </p>
      <div
        role="group"
        aria-label="Priority scale. Each zone explains what landing in it means."
        className="w-full"
      >
        <svg viewBox="-30 -12 260 188" className="block h-auto w-full select-none">
          {/* The comb with smooth gradient across all 60 bars. */}
          <g
            strokeWidth={TICK_WIDTH}
            strokeLinecap="round"
            opacity={clamped === null ? 0.3 : 1}
          >
            {ticks.map((tick) => (
              <line
                key={tick.index}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                stroke={tick.colour}
                opacity={activeZone === null || activeZone === tick.zone ? 1 : 0.22}
                className="transition-opacity duration-150"
              />
            ))}
          </g>

          {SCALE_MARKS.map((mark) => {
            const at = pointAt(mark.fraction, R_LABEL);
            return (
              <text
                key={mark.label}
                x={at.x}
                y={at.y + 3.5}
                textAnchor={labelAnchor(mark.fraction)}
                fontSize={9.5}
                fontWeight={600}
                fill="#8b94a1"
                fontFamily="var(--font-body), var(--font-lato), sans-serif"
              >
                {mark.label}
              </text>
            );
          })}

          {needle ? (
            <g className="text-ink">
              <polygon points={needle} fill="currentColor" />
              <circle cx={CX} cy={CY} r={11} fill={HUB_FILL} />
              <circle cx={CX} cy={CY} r={6} fill="currentColor" />
            </g>
          ) : (
            <circle cx={CX} cy={CY} r={9} fill={HUB_FILL} />
          )}

          {/* The hover targets for each of the 6 zones. */}
          {ZONE_NOTES.map((zone) => {
            const span = ZONE_SPANS[zone.id];
            return (
              <path
                key={`hit-${zone.id}`}
                d={arcPath(span.from, span.to, R_HIT)}
                fill="none"
                stroke="#000"
                strokeOpacity={0}
                strokeWidth={HIT_WIDTH}
                strokeLinecap="butt"
                tabIndex={0}
                role="button"
                aria-pressed={pinnedZone === zone.id}
                aria-label={`${zone.label} priority, ${zone.range}. ${zone.body} ${zone.reach} Priority orders the queue; it does not decide who we work with.`}
                className="cursor-help outline-none"
                onMouseEnter={() => setHoveredZone(zone.id)}
                onMouseLeave={() => setHoveredZone(null)}
                onFocus={() => setHoveredZone(zone.id)}
                onBlur={() => setHoveredZone(null)}
                onClick={() =>
                  setPinnedZone((current) =>
                    current === zone.id ? null : zone.id,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setPinnedZone((current) =>
                      current === zone.id ? null : zone.id,
                    );
                  } else if (event.key === "Escape") {
                    setPinnedZone(null);
                  }
                }}
              />
            );
          })}
        </svg>
      </div>

      {/* The readout under the dial. */}
      <dl className="mt-2 w-full px-1">
        <div className="flex items-baseline justify-between gap-3 border-b border-rule-soft pb-1.5">
          <dt className="font-body text-[11px] lg:text-[12px] font-bold tracking-[0.04em] text-dim uppercase">
            Priority
          </dt>
          <dd className="font-body text-[22px] lg:text-[25px] leading-none font-semibold tracking-[-0.03em] text-ink tabular-nums">
            {score === null ? "—" : score.toFixed(2)}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-3 border-b border-rule-soft py-1.5">
          <dt className="text-[12px] lg:text-[12.5px] font-medium text-faint">Band</dt>
          <dd
            className={`text-[12.5px] lg:text-[13.5px] font-semibold tracking-[-0.01em] ${
              score === null ? "text-faint" : bandStyle.text
            }`}
          >
            {score === null ? "Not scored yet" : (bandLabel ?? "—")}
          </dd>
        </div>

        {covered !== null && (
          <div className="flex items-baseline justify-between gap-3 pt-1.5">
            <dt className="text-[12px] lg:text-[12.5px] font-medium text-faint">Parameters</dt>
            <dd className="font-body text-[12.5px] lg:text-[13px] font-semibold text-dim tabular-nums">
              {covered} of {FACTOR_ORDER.length}
            </dd>
          </div>
        )}
      </dl>

      {/* The zone explainer tooltip overlay — positioned beside the gauge without covering it */}
      <AnimatePresence>
        {activeNote && tooltipPos && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            aria-hidden="true"
            className="pointer-events-none absolute z-50 w-[220px] rounded-inset border border-white/10 bg-[#161b21] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.4)]"
            style={tooltipPos.style}
          >
            <div className="flex items-baseline justify-between gap-1.5 border-b border-white/10 pb-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: activeNote.colour }}
                />
                <span className="truncate text-[12px] font-semibold tracking-[-0.01em] text-white">
                  {activeNote.label}
                </span>
              </div>
              <span className="shrink-0 font-body text-[10.5px] font-medium text-white/50 tabular-nums">
                {activeNote.range}
              </span>
            </div>

            <p className="mt-2 text-[11.5px] leading-[1.5] text-white/80">
              {activeNote.body}
            </p>

            <p className="mt-2 border-t border-white/10 pt-1.5 text-[11px] leading-[1.4] text-white/60">
              {activeNote.reach}
            </p>

            <p className="mt-1.5 text-[10.5px] leading-[1.35] font-medium text-white/40">
              Priority orders the queue.
            </p>

            {/* Green diamond arrow dynamically placed on the edge pointing at gauge/cursor */}
            <div
              aria-hidden="true"
              className="absolute size-2.5 rounded-[2px] bg-primary fill-primary z-50"
              style={tooltipPos.arrowStyle}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
