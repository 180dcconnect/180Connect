"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatCompactGbp, formatGbp } from "@/lib/income-band";
import type { FlowBand, FundFlow } from "@/lib/financials/financial-series";

/**
 * A filed year as a flow: what came in, the pot it made, and what it paid for.
 *
 * ── Which chart, and why this one ────────────────────────────────────────────
 *
 * Built on **G22 Aggregate Sankey** (`glance-gallery.html`, "Channels pour into
 * plans") — its geometry, its ribbon curve and its caption grammar. The Lupi
 * candidates were checked first and all fail on the same point: L5 Radial
 * Convergence and L12 Type Colonnade encode many-to-one, and drop the spending
 * half of a claim that is fundamentally two-sided. L12 also wants a per-item
 * roster, and the register publishes six totals rather than a list of
 * donations. F7 Stacked Rungs can draw both sides but not the balance between
 * them, and is the bar panel this replaces. F9 Rung Waterfall asserts an order
 * of deductions, and there is no sense in which charitable activities happens
 * before raising funds.
 *
 * ── Three columns, not a woven graph ────────────────────────────────────────
 *
 * G22 draws source-to-destination ribbons because it knows which channel became
 * which plan. We do not: the register does not publish which income line paid
 * for which activity, and drawing that mapping would invent the one fact this
 * chart type most tempts you to invent. So every inflow converges on one hub
 * and every outflow leaves it. The hub is the honest statement — the money was
 * pooled.
 *
 * ── The widths add up, by construction ──────────────────────────────────────
 *
 * `buildFundFlow` balances the sides with the surplus or drawdown band and
 * returns null rather than hand back something that cannot be squared, so
 * nothing here is scaled or clipped to fit. Nested "of which" lines —
 * government income, grants to institutions, governance — are deliberately not
 * bands: they are subsets of bands already drawn, and in a diagram whose whole
 * contract is that width means money, a subset drawn as a sibling is a
 * double-count. They sit in the footnotes.
 *
 * ── Two families, not ten colours ───────────────────────────────────────────
 *
 * The figure is drawn after the ADEME energy-balance Sankey: one ramp on the
 * side money comes from, another on the side it goes to, both ramped by rank so
 * the darkest band is the biggest. That is two hues and a lightness scale, not
 * ten categorical colours — the earlier all-grey version was right that ten
 * hues is past every palette's ceiling, and wrong that side is not worth
 * encoding. Side is the first question a reader asks of a Sankey, and hue
 * answers it before the eye reaches a label.
 *
 * Which hue goes where is not free choice. Green reads as money coming in and
 * red-brick as money going out to anyone who has ever read a set of accounts,
 * so the ramps follow that and the reader spends no attention learning them.
 *
 * The balancing band sits outside both ramps on purpose: a slate that is
 * neither green nor brick, because a residual is not a line the charity filed
 * and colour is the cheapest way to say so. The dotted rule and the BALANCE
 * rubric above it say it in words.
 *
 * ── A warm plate inside a cool app ──────────────────────────────────────────
 *
 * The app's ground is cool filing stock and its ink is cool near-black; the
 * reference palette is warm cream and warm brown-black. Rather than let one
 * bleed into the other, the figure is a self-contained plate: everything inside
 * the SVG takes the warm system, everything outside it — heading, year strip,
 * table — stays on the app's tokens. An inset figure with its own ground reads
 * as intent. The same two colours half-applied reads as a mistake.
 *
 * ── Interaction ─────────────────────────────────────────────────────────────
 *
 * Every band is a real filed line, so hover is legitimate rather than
 * decoration on nothing. But the interaction earns its keep on the *year* axis:
 * the year strip steps through the filing history, which is the dimension a
 * static Sankey genuinely cannot show. Hovering a band traces its ribbon and
 * dims the rest; clicking pins it. Fat transparent twin rects carry the
 * pointer, per the threads pattern — a 10px ribbon is not a hit target.
 */

/* ── Plate tokens ─────────────────────────────────────────────────────────────
 *
 * Sampled from the two reference plates: a cream ground, warm brown-black ink,
 * and a hairline in the same warm family. Local constants rather than CSS
 * variables because they exist only inside this figure — promoting them to the
 * theme would invite them into pages that are cool by design.
 */
const PLATE = "#F4F1EA";
const PLATE_EDGE = "#E3DED1";
const FF_INK = "#2A2722";
const FF_DIM = "#6C665C";
const FF_FAINT = "#9C9488";
const FF_RULE = "#DAD3C4";

/**
 * The two ramps, dark to light. Assigned by rank across the whole ramp rather
 * than by loop index, so a year with three filed lines still spans the full
 * range and lightness stays readable as size at any band count.
 *
 * Green for money in and warm brick for money out, because that is the prior
 * every reader of a set of accounts already has and fighting it costs a beat of
 * comprehension on every glance for nothing in return.
 */
const IN_RAMP = ["#204A3E", "#356B58", "#557F70", "#83A597", "#ADC5B9", "#CFDED6"];
const OUT_RAMP = ["#8C3A2B", "#B05840", "#C67C5C", "#D8A07D", "#E6BE9E", "#F0D7BE"];
/**
 * Outside both ramps: a residual is not a filed line.
 *
 * One slate serves the surplus and the drawdown both. They are the same
 * quantity — `income − expenditure` — given a direction, they never appear in
 * the same year, and the side it is drawn on already says which one it is. A
 * second hue here would be two names for one idea, and would have to come out
 * of the small stock of colours that still read as neither green nor brick.
 */
const RESIDUAL_FILL = "#8695A3";

/* ── Geometry, in viewBox units ───────────────────────────────────────────── */
const VIEW_W = 900;
const VIEW_H = 520;
const PAD = 16;
/** Column-header baseline, then the shade legend under it. */
const HEAD_Y = 25;
const LEGEND_Y = 43;
const SWATCH_Y = 47;
const SWATCH_H = 7;
const SWATCH_W = 22;
const SWATCH_GAP = 2;
/** The group rubric and its dotted rule, above the first band on each side. */
const GROUP_LABEL_Y = 71;
const GROUP_RULE_Y = 75;
const PLOT_TOP = 88;
const PLOT_BOTTOM = VIEW_H - 40;
const PLOT_H = PLOT_BOTTOM - PLOT_TOP;

const NODE_W = 10;
/** Room outside the columns for the direct labels. */
const COL_L_X = 238;
const COL_R_X = VIEW_W - 238 - NODE_W;
const HUB_X = VIEW_W / 2 - NODE_W / 2;
const TEXT_L = PAD;
const TEXT_R = VIEW_W - PAD;
/** Where the label rule stops running flat and turns for the node. */
const ELBOW = 26;

/** Gaps between stacked bands, larger on the right where there are fewer. */
const GAP_L = 10;
const GAP_R = 16;
/** How much wider the gap above a residual band is, to hold the BALANCE rule. */
const RESIDUAL_GAP_SCALE = 2.4;
/**
 * Vertical room one label block needs.
 *
 * The block runs from the name's cap height (labelY − 10) to the bracket rule
 * under the value (labelY + 12), so 22 units are occupied and 28 leaves a
 * visible lane between two stacked labels.
 */
const LABEL_PITCH = 28;
/** Below this, a ribbon vanishes entirely; the label rule still finds it. */
const MIN_BAND_H = 1.4;

type Placed = {
  band: FlowBand;
  y: number;
  height: number;
  hubY: number;
  hubHeight: number;
  share: number;
  shade: string;
  /** Where the two-line label sits, after de-collision — not the band centre. */
  labelY: number;
};

/**
 * Spread a rank across the whole ramp.
 *
 * With two filed lines this picks the darkest and the lightest rather than the
 * first two, so a small charity's chart has the same contrast as a large one's.
 */
function shadeAt(ramp: string[], rank: number, count: number): string {
  if (count <= 1) return ramp[0];
  const step = Math.round((rank * (ramp.length - 1)) / (count - 1));
  return ramp[Math.min(step, ramp.length - 1)];
}

/**
 * Push stacked labels apart without letting them leave the plot.
 *
 * Forward pass opens the collisions downward, backward pass pulls the tail back
 * inside the bottom, forward pass repairs anything the second pass re-collided.
 * Three passes converge for any input that fits, and at seven bands over 390
 * units it always fits with room to spare.
 */
function declash(centres: number[], pitch: number, top: number, bottom: number): number[] {
  const out = [...centres];
  for (let i = 1; i < out.length; i += 1) out[i] = Math.max(out[i], out[i - 1] + pitch);
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const ceiling = i === out.length - 1 ? bottom : out[i + 1] - pitch;
    out[i] = Math.min(out[i], ceiling);
  }
  for (let i = 0; i < out.length; i += 1) {
    const floor = i === 0 ? top : out[i - 1] + pitch;
    out[i] = Math.max(out[i], floor);
  }
  return out;
}

/**
 * Stack one side.
 *
 * The outer column carries the gaps and the hub face does not, so a band is
 * fractionally taller where it meets the hub. That is the standard resolution
 * and it is the right way round: the gaps are a reading aid on the column,
 * while the hub has to stay solid because it represents one undivided pot.
 *
 * The balancing band is pushed to the bottom of its column and taken out of the
 * ramp entirely, because it is a residual rather than a filed line — position
 * and hue both say so, and the dotted BALANCE rule says it a third time.
 */
function stack(bands: FlowBand[], total: number, gap: number, ramp: string[]): Placed[] {
  const ordered = [...bands].sort((a, b) => {
    const residual = (band: FlowBand) => (band.kind === "filed" ? 0 : 1);
    return residual(a) - residual(b) || b.amount - a.amount;
  });
  const filedCount = ordered.filter((band) => band.kind === "filed").length;
  // The boundary above a residual band is opened wider than the rest, because
  // the BALANCE rule and its rubric have to fit in it without landing on the
  // label of the band above. The hub face takes none of these gaps — it is one
  // undivided pot and has to stay solid.
  const gapAbove = ordered.map((band, index) =>
    index === 0 ? 0 : band.kind === "filed" ? gap : gap * RESIDUAL_GAP_SCALE,
  );
  const gaps = gapAbove.reduce((sum, each) => sum + each, 0);
  const drawable = Math.max(0, PLOT_H - gaps);
  let y = PLOT_TOP;
  let hubY = PLOT_TOP;

  const laid = ordered.map((band, rank) => {
    y += gapAbove[rank];
    const share = total > 0 ? band.amount / total : 0;
    const height = share * drawable;
    const hubHeight = share * PLOT_H;
    const placed: Placed = {
      band,
      y,
      height,
      hubY,
      hubHeight,
      share,
      shade: band.kind === "filed" ? shadeAt(ramp, rank, filedCount) : RESIDUAL_FILL,
      labelY: y + height / 2,
    };
    y += height;
    hubY += hubHeight;
    return placed;
  });

  const centres = declash(
    laid.map((placed) => placed.labelY),
    LABEL_PITCH,
    // Inset so the topmost name clears the dotted group rule and the lowest
    // bracket clears the pooled-total caption.
    PLOT_TOP + 12,
    PLOT_BOTTOM - 14,
  );
  return laid.map((placed, index) => ({ ...placed, labelY: centres[index] }));
}

/**
 * A share as the reader would say it.
 *
 * A filed line worth a fifth of a percent is still a filed line, and rounding
 * it to "0%" beside a visible band reads as a bug in the chart rather than as a
 * small number.
 */
function share(fraction: number): string {
  const percent = fraction * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

/** G22's ribbon: cubic beziers with control points at the horizontal midpoint,
 *  so it leaves and arrives flat and the eye reads band edge into hub edge. */
function ribbon(
  x0: number,
  x1: number,
  top0: number,
  bottom0: number,
  top1: number,
  bottom1: number,
): string {
  const mid = (x0 + x1) / 2;
  return (
    `M${x0} ${top0} C${mid} ${top0} ${mid} ${top1} ${x1} ${top1} ` +
    `L${x1} ${bottom1} C${mid} ${bottom1} ${mid} ${bottom0} ${x0} ${bottom0} Z`
  );
}

/**
 * The reference's label bracket: a flat rule under the two-line label, then an
 * elbow across to the band it names.
 *
 * The elbow is what lets a label sit where it is legible rather than where its
 * band happens to be — with six filed lines, two of them under a percent, the
 * alternative is either unlabelled slivers or overlapping text.
 */
function bracket(
  side: "in" | "out",
  labelY: number,
  bandCentre: number,
): string {
  const ruleY = labelY + 12;
  if (side === "in") {
    const turn = COL_L_X - ELBOW;
    return `M${TEXT_L} ${ruleY} L${turn} ${ruleY} L${COL_L_X} ${bandCentre}`;
  }
  const nodeEdge = COL_R_X + NODE_W;
  const turn = nodeEdge + ELBOW;
  return `M${TEXT_R} ${ruleY} L${turn} ${ruleY} L${nodeEdge} ${bandCentre}`;
}

export function FundFlowSankey({ flows }: { flows: FundFlow[] }) {
  const [yearIndex, setYearIndex] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  /** Bumped on click to replay the entrance, per the reveal contract. */
  const [replay, setReplay] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Nothing to draw is a legitimate state, not an error: most charities file a
  // year that cannot be squared, and the caller renders the income panel
  // instead. Guarded here as well so the component is safe on its own terms —
  // an empty list would otherwise index to -1 and read `.inflows` of undefined.
  const flow = flows.length > 0 ? flows[Math.min(yearIndex, flows.length - 1)] : null;

  const inflows = useMemo(
    () => (flow ? stack(flow.inflows, flow.total, GAP_L, IN_RAMP) : []),
    [flow],
  );
  const outflows = useMemo(
    () => (flow ? stack(flow.outflows, flow.total, GAP_R, OUT_RAMP) : []),
    [flow],
  );

  // Scroll into view to play; click anywhere on the figure to replay.
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer to wait on, so reveal on the next frame rather than during
      // this effect — a synchronous setState here cascades a second render.
      const frame = requestAnimationFrame(() => setRevealed(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // After every hook, so the hook order stays fixed across renders.
  if (!flow) return null;

  const focus = pinned ?? hovered;
  const active =
    [...inflows, ...outflows].find((placed) => placed.band.id === focus) ?? null;

  /** Full strength when nothing is picked out, so the default view is the
   *  chart rather than a chart waiting to be interacted with. */
  const bandOpacity = (id: string) => (focus === null || focus === id ? 1 : 0.26);
  const ribbonOpacity = (id: string) =>
    focus === null ? 0.72 : focus === id ? 0.92 : 0.1;
  const labelOpacity = (id: string) => (focus === null || focus === id ? 1 : 0.3);

  const sides = [
    { key: "in" as const, placed: inflows, ramp: IN_RAMP, rubric: "Filed income lines" },
    { key: "out" as const, placed: outflows, ramp: OUT_RAMP, rubric: "Filed spending lines" },
  ];

  return (
    <div ref={rootRef} className="mt-6 border-t border-rule-soft pt-5">
      <style>{`
        @keyframes ffFade { from { opacity: 0 } }
        .ff-fade { animation: ffFade .9s ease both }
        @media (prefers-reduced-motion: reduce) { .ff-fade { animation: none } }
      `}</style>

      {/* Card four-piece: conclusion title, subtitle carrying the legend and
          the range, the figure, then the all-caps source line. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[16.5px] font-bold tracking-[-0.02em] text-ink">
          {flow.headline}
        </h3>
        {flows.length > 1 && (
          <div className="flex items-center gap-1" role="group" aria-label="Filed year">
            {flows.map((candidate, index) => (
              <button
                key={candidate.periodEnd}
                type="button"
                onClick={() => {
                  setYearIndex(index);
                  setPinned(null);
                  setReplay((n) => n + 1);
                }}
                aria-pressed={index === yearIndex}
                className={`rounded-[4px] px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.06em] transition-colors ${
                  index === yearIndex
                    ? "bg-ink text-white"
                    : "text-faint hover:bg-paper hover:text-dim"
                }`}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="mt-1 text-[11.5px] text-dim">
        Ribbon width = pounds through the year · green in, brick out · shade =
        rank by size · year ended{" "}
        {new Date(flow.periodEnd).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
        {flows.length > 1 && " · pick a year above"}
      </p>

      <div className="mt-3 overflow-x-auto">
        <svg
          key={`${flow.periodEnd}-${replay}`}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full min-w-[46rem] cursor-default"
          /* The ribbons multiply against the plate, which is what gives the
             reference its stained-glass overlaps. Isolate so they multiply
             against the cream rect below and never against the page. */
          style={{ isolation: "isolate" }}
          onClick={() => setPinned(null)}
          role="img"
          aria-label={`Fund flow for ${flow.label}. In: ${flow.inflows
            .map((band) => `${band.label} ${formatGbp(band.amount)}`)
            .join(", ")}. Out: ${flow.outflows
            .map((band) => `${band.label} ${formatGbp(band.amount)}`)
            .join(", ")}.`}
        >
          <rect
            x={0.5}
            y={0.5}
            width={VIEW_W - 1}
            height={VIEW_H - 1}
            rx={5}
            fill={PLATE}
            stroke={PLATE_EDGE}
          />

          {/* Column headers and the shade legend, mirrored on the two sides. */}
          <text
            x={TEXT_L}
            y={HEAD_Y}
            fontSize={11}
            fontWeight={800}
            letterSpacing="0.09em"
            fill={FF_INK}
          >
            MONEY IN
          </text>
          <text
            x={TEXT_R}
            y={HEAD_Y}
            textAnchor="end"
            fontSize={11}
            fontWeight={800}
            letterSpacing="0.09em"
            fill={FF_INK}
          >
            MONEY OUT
          </text>

          {sides.map(({ key, ramp }) => {
            const width = ramp.length * SWATCH_W + (ramp.length - 1) * SWATCH_GAP;
            const x0 = key === "in" ? TEXT_L : TEXT_R - width;
            return (
              <g key={`legend-${key}`}>
                <text
                  x={key === "in" ? TEXT_L : TEXT_R}
                  y={LEGEND_Y}
                  textAnchor={key === "in" ? "start" : "end"}
                  fontSize={6.5}
                  fontWeight={600}
                  letterSpacing="0.12em"
                  fill={FF_FAINT}
                >
                  SMALLEST SHARE OF THE YEAR ⟶ LARGEST
                </text>
                {[...ramp].reverse().map((fill, index) => (
                  <rect
                    key={fill}
                    x={x0 + index * (SWATCH_W + SWATCH_GAP)}
                    y={SWATCH_Y}
                    width={SWATCH_W}
                    height={SWATCH_H}
                    fill={fill}
                  />
                ))}
              </g>
            );
          })}

          {/* Group rubrics, after the reference's SOURCES / USAGES rules. */}
          {sides.map(({ key, rubric }) => (
            <g key={`rubric-${key}`}>
              <text
                x={key === "in" ? TEXT_L : TEXT_R}
                y={GROUP_LABEL_Y}
                textAnchor={key === "in" ? "start" : "end"}
                fontSize={7.5}
                fontWeight={700}
                letterSpacing="0.13em"
                fill={FF_DIM}
              >
                {rubric.toUpperCase()}
              </text>
              <line
                x1={key === "in" ? TEXT_L : COL_R_X}
                x2={key === "in" ? COL_L_X + NODE_W : TEXT_R}
                y1={GROUP_RULE_Y}
                y2={GROUP_RULE_Y}
                stroke={FF_RULE}
                strokeWidth={0.8}
                strokeDasharray="1 3"
              />
            </g>
          ))}

          {/* Ribbons, under the solid column bands and the labels. */}
          <g style={{ mixBlendMode: "multiply" }}>
            {inflows.map((placed, index) => (
              <path
                key={`in-${placed.band.id}`}
                d={ribbon(
                  COL_L_X + NODE_W,
                  HUB_X,
                  placed.y,
                  placed.y + Math.max(placed.height, MIN_BAND_H),
                  placed.hubY,
                  placed.hubY + Math.max(placed.hubHeight, MIN_BAND_H),
                )}
                fill={placed.shade}
                opacity={revealed ? ribbonOpacity(placed.band.id) : 0}
                className={revealed ? "ff-fade transition-opacity" : undefined}
                style={{ animationDelay: `${0.2 + index * 0.06}s` }}
              />
            ))}
            {outflows.map((placed, index) => (
              <path
                key={`out-${placed.band.id}`}
                d={ribbon(
                  HUB_X + NODE_W,
                  COL_R_X,
                  placed.hubY,
                  placed.hubY + Math.max(placed.hubHeight, MIN_BAND_H),
                  placed.y,
                  placed.y + Math.max(placed.height, MIN_BAND_H),
                )}
                fill={placed.shade}
                opacity={revealed ? ribbonOpacity(placed.band.id) : 0}
                className={revealed ? "ff-fade transition-opacity" : undefined}
                style={{ animationDelay: `${0.28 + index * 0.06}s` }}
              />
            ))}
          </g>

          {/* The hub: one undivided block, because that is the claim. */}
          <rect
            x={HUB_X}
            y={PLOT_TOP}
            width={NODE_W}
            height={PLOT_H}
            rx={2}
            fill={FF_INK}
            className={revealed ? "ff-fade" : undefined}
            opacity={revealed ? 1 : 0}
          />
          <text
            x={HUB_X + NODE_W / 2}
            y={PLOT_BOTTOM + 16}
            textAnchor="middle"
            fontSize={7}
            fontWeight={700}
            letterSpacing="0.13em"
            fill={FF_DIM}
          >
            {`${formatCompactGbp(flow.total)} POOLED`.toUpperCase()}
          </text>

          {/* The BALANCE rule, drawn only on the side that carries a residual.
              It separates what the charity filed from what the arithmetic
              leaves over, which is a distinction the reader is owed. */}
          {sides.map(({ key, placed }) => {
            const residual = placed.find((entry) => entry.band.kind !== "filed");
            if (!residual) return null;
            // Centred in the widened boundary that `stack` opened for it.
            const y =
              residual.y - ((key === "in" ? GAP_L : GAP_R) * RESIDUAL_GAP_SCALE) / 2;
            return (
              <g key={`balance-${key}`} opacity={revealed ? 1 : 0}>
                <text
                  x={key === "in" ? TEXT_L : TEXT_R}
                  y={y - 4}
                  textAnchor={key === "in" ? "start" : "end"}
                  fontSize={7.5}
                  fontWeight={700}
                  letterSpacing="0.13em"
                  fill={FF_DIM}
                >
                  BALANCE
                </text>
                <line
                  x1={key === "in" ? TEXT_L : COL_R_X}
                  x2={key === "in" ? COL_L_X + NODE_W : TEXT_R}
                  y1={y}
                  y2={y}
                  stroke={FF_RULE}
                  strokeWidth={0.8}
                  strokeDasharray="1 3"
                />
              </g>
            );
          })}

          {/* Columns and their bracketed labels. */}
          {sides.map(({ key, placed }) => {
            const x = key === "in" ? COL_L_X : COL_R_X;
            const anchor = key === "in" ? ("start" as const) : ("end" as const);
            const textX = key === "in" ? TEXT_L : TEXT_R;
            // Written per side rather than derived from one margin: the two
            // gutters happen to be the same width today, and a hit target that
            // silently depends on that is a trap for whoever changes one.
            const hitX = key === "in" ? TEXT_L - 6 : COL_R_X;
            const hitW =
              key === "in" ? COL_L_X + NODE_W - TEXT_L + 12 : TEXT_R - COL_R_X + 6;
            return placed.map((entry, index) => {
              const centre = entry.y + Math.max(entry.height, MIN_BAND_H) / 2;
              const picked = focus === entry.band.id;
              const hitTop = Math.min(entry.labelY - 15, entry.y - 3);
              const hitBottom = Math.max(entry.labelY + 16, entry.y + entry.height + 3);
              return (
                <g
                  key={`${key}-${entry.band.id}`}
                  onMouseEnter={() => setHovered(entry.band.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(entry.band.id)}
                  onBlur={() => setHovered(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPinned((current) =>
                      current === entry.band.id ? null : entry.band.id,
                    );
                  }}
                  tabIndex={0}
                  aria-label={`${entry.band.label}: ${formatGbp(entry.band.amount)}`}
                  className="cursor-pointer outline-none"
                >
                  {/* The fat invisible twin — a 10px band is not a hit target. */}
                  <rect
                    x={hitX}
                    y={hitTop}
                    width={hitW}
                    height={Math.max(hitBottom - hitTop, 12)}
                    fill="#000"
                    fillOpacity={0}
                  />
                  <path
                    d={bracket(key, entry.labelY, centre)}
                    fill="none"
                    stroke={picked ? FF_INK : FF_RULE}
                    strokeWidth={picked ? 1 : 0.7}
                    opacity={revealed ? labelOpacity(entry.band.id) : 0}
                    className={revealed ? "ff-fade transition-opacity" : undefined}
                    style={{ animationDelay: `${0.12 + index * 0.06}s` }}
                  />
                  <rect
                    x={x}
                    y={entry.y}
                    width={NODE_W}
                    height={Math.max(entry.height, 2)}
                    fill={entry.shade}
                    opacity={revealed ? bandOpacity(entry.band.id) : 0}
                    className={revealed ? "ff-fade transition-opacity" : undefined}
                    style={{ animationDelay: `${index * 0.06}s` }}
                  />
                  <g
                    className={revealed ? "ff-fade" : undefined}
                    opacity={revealed ? labelOpacity(entry.band.id) : 0}
                    style={{ animationDelay: `${0.1 + index * 0.06}s` }}
                  >
                    <text
                      x={textX}
                      y={entry.labelY - 3}
                      textAnchor={anchor}
                      fontSize={10}
                      fontWeight={700}
                      fill={FF_INK}
                    >
                      {entry.band.label}
                    </text>
                    <text
                      x={textX}
                      y={entry.labelY + 8}
                      textAnchor={anchor}
                      fontSize={9.5}
                      fill={FF_DIM}
                    >
                      {formatCompactGbp(entry.band.amount)} · {share(entry.share)}
                    </text>
                  </g>
                </g>
              );
            });
          })}
        </svg>
      </div>

      {/* Fixed status row, not a floating card: with bands this thin, a card
          that follows the cursor covers the bands either side of the one read. */}
      <p className="mt-1.5 min-h-[18px] text-[12px] text-dim" aria-live="polite">
        {active ? (
          <>
            <span className="font-semibold text-ink">{active.band.label}</span> —{" "}
            {formatGbp(active.band.amount)}, {share(active.share)} of the{" "}
            {formatCompactGbp(flow.total)} that passed through
            {active.band.kind === "surplus" &&
              " · what the year's income left after spending"}
            {active.band.kind === "reserves" &&
              " · spending the year's income did not cover"}
            {pinned && (
              <span className="ml-2 font-mono text-[9px] font-bold tracking-[0.1em] text-faint">
                PINNED · CLICK AGAIN TO RELEASE
              </span>
            )}
          </>
        ) : (
          "Every band is money the annual return itself reports. Hover one to trace it, click to pin."
        )}
      </p>

      {/* The reference's bordered note block, on the plate's own ground so it
          reads as part of the figure rather than as body copy. */}
      {(flow.incomeDetail.length > 0 || flow.spendDetail.length > 0) && (
        <div
          className="mt-3 rounded-[5px] border px-4 py-3"
          style={{ borderColor: PLATE_EDGE, backgroundColor: PLATE }}
        >
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {flow.incomeDetail.length > 0 && (
              <div>
                <p
                  className="font-mono text-[9.5px] font-semibold tracking-[0.1em] uppercase"
                  style={{ color: FF_DIM }}
                >
                  Of the income, also reported
                </p>
                <ul className="mt-1.5 space-y-1">
                  {flow.incomeDetail.map((source) => (
                    <li
                      key={source.label}
                      className="flex items-baseline justify-between gap-3 text-[12.5px]"
                    >
                      <span style={{ color: FF_DIM }}>{source.label}</span>
                      <span
                        className="font-mono tabular-nums"
                        style={{ color: FF_INK }}
                      >
                        {formatCompactGbp(source.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {flow.spendDetail.length > 0 && (
              <div>
                <p
                  className="font-mono text-[9.5px] font-semibold tracking-[0.1em] uppercase"
                  style={{ color: FF_DIM }}
                >
                  Of the spending, also reported
                </p>
                <ul className="mt-1.5 space-y-1">
                  {flow.spendDetail.map((use) => (
                    <li
                      key={use.label}
                      className="flex items-baseline justify-between gap-3 text-[12.5px]"
                    >
                      <span style={{ color: FF_DIM }}>
                        {use.label}
                        {use.within && (
                          <span style={{ color: FF_FAINT }}> · within {use.within}</span>
                        )}
                      </span>
                      <span
                        className="font-mono tabular-nums"
                        style={{ color: FF_INK }}
                      >
                        {formatCompactGbp(use.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p
            className="mt-2.5 text-[11.5px] leading-[1.5]"
            style={{ color: FF_FAINT }}
          >
            These are components of the bands above, not extra money — the
            register reports them inside the lines they belong to, so they are
            listed rather than drawn.
            {Math.max(flow.incomeDrift, flow.spendDrift) > 0.001 &&
              ` The filed lines and the filed totals differ by ${(
                Math.max(flow.incomeDrift, flow.spendDrift) * 100
              ).toFixed(1)}% this year, which is the return restating a figure between the two.`}
          </p>
        </div>
      )}

      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className="inline-block transition-transform group-open:rotate-90"
          >
            ›
          </span>
          View as a table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[24rem] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-rule-soft text-left text-faint">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Line
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Direction
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Amount
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ...inflows.map((entry) => ({ entry, direction: "In" })),
                ...outflows.map((entry) => ({ entry, direction: "Out" })),
              ].map(({ entry, direction }) => (
                <tr
                  key={`${direction}-${entry.band.id}`}
                  className="border-b border-rule-soft last:border-0"
                >
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink">
                    {entry.band.label}
                  </th>
                  <td className="py-1.5 pr-3 text-dim">{direction}</td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums text-dim">
                    {formatGbp(entry.band.amount)}
                  </td>
                  <td className="py-1.5 font-mono tabular-nums text-dim">
                    {share(entry.share)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="mt-3 font-mono text-[9.5px] font-medium tracking-[0.08em] text-faint uppercase">
        Aggregate Sankey · {flow.label} annual return · Charity Commission
      </p>
    </div>
  );
}
