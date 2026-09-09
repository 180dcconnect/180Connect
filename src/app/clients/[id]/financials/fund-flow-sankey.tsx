"use client";

import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from "react";

import { formatCompactGbp, formatGbp } from "@/lib/income-band";
import type { FlowBand, FundFlow } from "@/lib/financials/financial-series";
import { Liquid } from "liquid-gooey";
import { InfoTooltip } from "@/components/ui/info-tooltip";

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
 * and colour is the cheapest way to say so. It sits at the bottom of its
 * column, out of the rank order.
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
 * A white ground with warm brown-black ink and a hairline in the same warm
 * family. Local constants rather than CSS variables because they exist only
 * inside this figure — promoting them to the theme would invite them into
 * pages that are cool by design.
 */
const PLATE = "#FFFFFF";
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
/**
 * The hub is the pooled pot both sides flow through, so it takes the darkest
 * income green rather than the plate ink — it reads as money, not furniture.
 */
const HUB_FILL = IN_RAMP[0];

/* ── Geometry, in viewBox units ───────────────────────────────────────────── */
const VIEW_W = 900;
const VIEW_H = 505;
const PAD = 16;
/** The IN / OUT / NET trio sits top-centre, in the gap between the columns. */
const TRIO_Y = 27;
/** Column-header baseline, then the shade legend under it. Pushed down to
 *  clear the trio above. */
const HEAD_Y = 60;
const LEGEND_Y = 78;
const SWATCH_Y = 82;
const SWATCH_H = 7;
const SWATCH_W = 22;
const SWATCH_GAP = 2;
/** The plot starts below the shade legend. */
const PLOT_TOP = 104;
const PLOT_BOTTOM = VIEW_H - 25;
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
/** Equal width for each year switch tab button, enabling liquid gooey indicator positioning. */
const YEAR_TAB_WIDTH = 58;

/**
 * The pour wipe's soft leading edge, in viewBox units.
 *
 * A hard clip edge sweeping across reads as a shutter; a gradient front reads as
 * liquid, which is what the figure is about. 70 units is roughly a third of the
 * distance a ribbon travels — wide enough that no single frame shows a line, and
 * narrow enough that the front is still a front rather than a general brightening.
 */
const FEATHER = 70;
/** How far each front travels, and where it starts. Written out rather than
 *  inlined because the mask rect, its gradient and its keyframe distance all
 *  have to agree, and a mismatch fails silently as a ribbon that never appears. */
const POUR_IN_FROM = COL_L_X;
const POUR_IN_SPAN = HUB_X + NODE_W - COL_L_X;
const POUR_OUT_FROM = HUB_X;
const POUR_OUT_SPAN = COL_R_X + NODE_W - HUB_X;

/** Gaps between stacked bands, larger on the right where there are fewer. */
const GAP_L = 10;
const GAP_R = 16;
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
 * and hue both say so.
 */
function stack(bands: FlowBand[], total: number, gap: number, ramp: string[]): Placed[] {
  const ordered = [...bands].sort((a, b) => {
    const residual = (band: FlowBand) => (band.kind === "filed" ? 0 : 1);
    return residual(a) - residual(b) || b.amount - a.amount;
  });
  const filedCount = ordered.filter((band) => band.kind === "filed").length;
  const gapAbove = ordered.map((_, index) => (index === 0 ? 0 : gap));
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
    // Inset so the topmost name clears the column headers and the lowest
    // bracket clears the plot edge.
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
  /** Clip ids for the two pour wipes. Scoped per instance so two figures on one
   *  page never share a clip. */
  const rawId = useId().replace(/:/g, "");
  const POUR_IN = `${rawId}-pour-in`;
  const POUR_OUT = `${rawId}-pour-out`;
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
    { key: "in" as const, placed: inflows, ramp: IN_RAMP },
    { key: "out" as const, placed: outflows, ramp: OUT_RAMP },
  ];

  /* The three figures for the trio above the columns: true filed income,
   * true filed spending, and the year's result. Residuals are excluded from
   * both sides, so IN − OUT is the result by construction. */
  const incomeTotal = flow.inflows
    .filter((band) => band.kind === "filed")
    .reduce((sum, band) => sum + band.amount, 0);
  const spendTotal = flow.outflows
    .filter((band) => band.kind === "filed")
    .reduce((sum, band) => sum + band.amount, 0);
  const net = incomeTotal - spendTotal;
  const netFill = net > 0 ? IN_RAMP[0] : net < 0 ? OUT_RAMP[0] : FF_DIM;
  const netTag = net > 0 ? "SURPLUS" : net < 0 ? "DEFICIT" : "BALANCED";

  return (
    <div ref={rootRef}>
      <style>{`
        /* The entrance is the diagram's own argument played once, slowly: the
           pot fills, the filed lines rise into it, the money pours across, the
           labels reach out to name what they point at. Every part moves along
           the axis it means — height for money, left-to-right for flow — so the
           animation teaches the encoding instead of decorating it.

           Nothing here overshoots and nothing snaps. A Sankey is a statement
           about volume, and volume does not bounce; the whole sequence is one
           long deceleration, and the beats overlap so there is never a frame
           where the figure has stopped moving and not yet started again. */
        @keyframes ffRise { from { opacity: 0; transform: translateY(11px) } }
        /* Bands and hub scale from their own base, so they grow upward the way
           a column of money does. Origin is set per element in the markup. */
        @keyframes ffGrowUp { from { transform: scaleY(0) } to { transform: scaleY(1) } }
        /* The soft front that carries a ribbon across. Applied to the mask rect,
           not the ribbons, so the ribbon geometry is never distorted. The travel
           distance differs per side, so the keyframe reads it off the element. */
        @keyframes ffPour { to { transform: translateX(var(--ff-travel)) } }
        @keyframes ffSlideIn { from { opacity: 0; transform: translateX(-15px) } }
        @keyframes ffSlideOut { from { opacity: 0; transform: translateX(15px) } }
        @keyframes ffDraw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }

        /* One easing does almost all of it: a long, flat-tailed deceleration
           that spends most of its time nearly settled. The pour gets the only
           other curve — it eases in as well as out, because a front that starts
           at full speed is the thing that reads as a shutter. */
        .ff-rise { animation: ffRise .6s cubic-bezier(.22,.68,.24,1) both }
        .ff-grow { animation: ffGrowUp .5s cubic-bezier(.22,.68,.24,1) both; transform-box: view-box }
        .ff-pour { animation: ffPour .76s cubic-bezier(.36,.1,.24,1) both; transform-box: view-box }
        .ff-slide-in { animation: ffSlideIn .52s cubic-bezier(.22,.68,.24,1) both }
        .ff-slide-out { animation: ffSlideOut .52s cubic-bezier(.22,.68,.24,1) both }
        .ff-draw { stroke-dasharray: 1; animation: ffDraw .52s cubic-bezier(.22,.68,.24,1) both }

        @media (prefers-reduced-motion: reduce) {
          .ff-rise, .ff-grow, .ff-pour,
          .ff-slide-in, .ff-slide-out, .ff-draw { animation: none }
          /* Both of these hide their element in the un-animated state, so the
             finished position has to be restated rather than merely un-animated:
             the dash would leave the rule undrawn, and the mask front would sit
             short of the ribbons and reveal none of them. */
          .ff-draw { stroke-dasharray: none }
          .ff-pour { transform: translateX(var(--ff-travel)) }
        }
      `}</style>

      {/* Conclusion title and the year switch share one row: the sentence says
          what happened, the switch steps through the filing history. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-[16.5px] font-medium font-serif tracking-[-0.02em] text-ink">
          Spent{" "}
          <span className="text-[#8C3A2B]">
            {formatCompactGbp(spendTotal)}
          </span>{" "}
          against{" "}
          <span className="text-go">
            {formatCompactGbp(incomeTotal)}
          </span>{" "}
          of income,{" "}
          {net < 0 ? (
            <>
              ending the year with a{" "}
              <span className="text-stop">
                {formatCompactGbp(-net)} deficit
              </span>
              .
            </>
          ) : net > 0 ? (
            <>
              ending the year with a{" "}
              <span className="text-go">
                {formatCompactGbp(net)} surplus
              </span>
              .
            </>
          ) : (
            "ending the year balanced."
          )}
        </h3>
        {flows.length > 1 && (
          <Liquid
            blur={5}
            contrast={18}
            fill="var(--ink)"
            shadow="0 2px 6px rgba(20, 26, 34, 0.25)"
            className="relative inline-flex items-center overflow-x-auto rounded-full border border-rule-soft bg-paper p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label="Filed year"
          >
            <Liquid.Item effect="move" move={{ springiness: 0.6, trail: 0.5, stretch: 0.25 }}>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-full bg-ink transition-transform duration-300 ease-out motion-reduce:transition-none"
                style={{
                  width: `${YEAR_TAB_WIDTH}px`,
                  transform: `translateX(${yearIndex * YEAR_TAB_WIDTH}px)`,
                }}
              />
            </Liquid.Item>

            <div className="relative z-10 flex items-center">
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
                  style={{ width: `${YEAR_TAB_WIDTH}px` }}
                  className={`flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-full font-mono text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ${
                    index === yearIndex
                      ? "text-white"
                      : "text-faint hover:text-dim"
                  }`}
                >
                  {candidate.label}
                </button>
              ))}
            </div>
          </Liquid>
        )}
      </div>

      <p className="mt-1 text-[13.5px] text-dim">
        Ribbon width = pounds through the year · year ended{" "}
        {new Date(flow.periodEnd).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </p>

      <div className="mt-3" onClick={() => setPinned(null)}>
        <div className="overflow-x-auto">
          <svg
            key={`${flow.periodEnd}-${replay}`}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full min-w-[46rem] cursor-default"
            /* The ribbons multiply against the plate, which is what gives the
               reference its stained-glass overlaps. Isolate so they multiply
               against the plate rect below and never against the page. */
            style={{ isolation: "isolate" }}
            role="img"
            aria-label={`Fund flow for ${flow.label}. In: ${flow.inflows
              .map((band) => `${band.label} ${formatGbp(band.amount)}`)
              .join(", ")}. Out: ${flow.outflows
              .map((band) => `${band.label} ${formatGbp(band.amount)}`)
              .join(", ")}.`}
          >
            <rect
              x={0}
              y={0}
              width={VIEW_W}
              height={VIEW_H}
              fill={PLATE}
            />

            {/* The two pour wipes. Each is a rect as wide as the distance it
                has to travel, filled with a gradient that is solid behind and
                fades out at its leading edge, and slid across the half of the
                plot its side occupies — left column outward for the inflows, hub
                outward for the outflows. Masking the reveal rather than
                animating `d` keeps the curve exact at every frame, and leaves
                the pointer targets identical to the static figure once the front
                has passed. */}
            <defs>
              {[
                {
                  id: POUR_IN,
                  from: POUR_IN_FROM,
                  span: POUR_IN_SPAN,
                  delay: "0.22s",
                },
                {
                  id: POUR_OUT,
                  from: POUR_OUT_FROM,
                  span: POUR_OUT_SPAN,
                  delay: "0.60s",
                },
              ].map(({ id, from, span, delay }) => {
                // The rect carries its own feather, so it must travel its own
                // width for the solid part to clear the far end.
                const travel = span + FEATHER;
                return (
                  <mask
                    key={id}
                    id={id}
                    maskUnits="userSpaceOnUse"
                    x={0}
                    y={0}
                    width={VIEW_W}
                    height={VIEW_H}
                  >
                    <linearGradient id={`${id}-front`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset={0} stopColor="#FFF" stopOpacity={1} />
                      <stop offset={span / travel} stopColor="#FFF" stopOpacity={1} />
                      <stop offset={1} stopColor="#FFF" stopOpacity={0} />
                    </linearGradient>
                    <rect
                      x={from - travel}
                      y={PLOT_TOP - 8}
                      width={travel}
                      height={PLOT_H + 16}
                      fill={`url(#${id}-front)`}
                      className={revealed ? "ff-pour" : undefined}
                      style={
                        {
                          "--ff-travel": `${travel}px`,
                          animationDelay: delay,
                        } as CSSProperties
                      }
                    />
                  </mask>
                );
              })}
            </defs>

          {/* The year's three figures, top-centre in the gap between the
              columns: what came in (green), what went out (brick), and the
              result. One line, centred, in the plate's own type scale. */}
          <text
            x={VIEW_W / 2}
            y={TRIO_Y}
            textAnchor="middle"
            /* The headline figures settle in last — they are the summary of the
               flow the reader has just watched, not its opening. */
            className={revealed ? "ff-rise" : undefined}
            style={{ animationDelay: "1.0s" }}
            opacity={revealed ? 1 : 0}
          >
            <tspan fontSize={12.5} fontWeight={800} fill={IN_RAMP[0]}>
              {formatCompactGbp(incomeTotal).toUpperCase()}
            </tspan>
            <tspan
              fontSize={7.5}
              fontWeight={700}
              letterSpacing="0.12em"
              fill={FF_DIM}
            >
              {"  IN  "}
            </tspan>
            <tspan fontSize={10} fill={FF_FAINT}>
              {"·"}
            </tspan>
            <tspan fontSize={12.5} fontWeight={800} fill={OUT_RAMP[0]}>
              {`  ${formatCompactGbp(spendTotal).toUpperCase()}`}
            </tspan>
            <tspan
              fontSize={7.5}
              fontWeight={700}
              letterSpacing="0.12em"
              fill={FF_DIM}
            >
              {"  OUT  "}
            </tspan>
            <tspan fontSize={10} fill={FF_FAINT}>
              {"·"}
            </tspan>
            <tspan fontSize={12.5} fontWeight={800} fill={netFill}>
              {`  ${net === 0 ? "" : formatCompactGbp(Math.abs(net)).toUpperCase()}${net === 0 ? "" : " "}${netTag}`}
            </tspan>
          </text>

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
            const wordProps = {
              fontSize: 6.5,
              fontWeight: 600,
              letterSpacing: "0.12em",
              fill: FF_FAINT,
            } as const;
            return (
              <g key={`legend-${key}`}>
                <text x={x0} y={LEGEND_Y} textAnchor="start" {...wordProps}>
                  SMALLEST
                </text>
                <text
                  x={x0 + width}
                  y={LEGEND_Y}
                  textAnchor="end"
                  {...wordProps}
                >
                  LARGEST
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

          {/* Ribbons, under the solid column bands and the labels. */}
          <g style={{ mixBlendMode: "multiply" }}>
            <g mask={`url(#${POUR_IN})`}>
              {inflows.map((placed) => (
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
                  className="cursor-pointer transition-opacity"
                  onMouseEnter={() => setHovered(placed.band.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPinned((current) =>
                      current === placed.band.id ? null : placed.band.id,
                    );
                  }}
                >
                  <title>{`${placed.band.label}: ${formatGbp(placed.band.amount)}`}</title>
                </path>
              ))}
            </g>
            <g mask={`url(#${POUR_OUT})`}>
              {outflows.map((placed) => (
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
                  className="cursor-pointer transition-opacity"
                  onMouseEnter={() => setHovered(placed.band.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPinned((current) =>
                      current === placed.band.id ? null : placed.band.id,
                    );
                  }}
                >
                  <title>{`${placed.band.label}: ${formatGbp(placed.band.amount)}`}</title>
                </path>
              ))}
            </g>
          </g>

          {/* The hub: one undivided block, because that is the claim. Its total
              now lives in the trio above the columns, so it carries no label. */}
          <rect
            x={HUB_X}
            y={PLOT_TOP}
            width={NODE_W}
            height={PLOT_H}
            fill={HUB_FILL}
            className={revealed ? "ff-grow" : undefined}
            style={{ transformOrigin: `${HUB_X}px ${PLOT_BOTTOM}px` }}
            opacity={revealed ? 1 : 0}
          />

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
            /* The right column does not move until the pour has crossed the
               hub, so the eye follows one front travelling left to right rather
               than two halves starting at once. */
            const beat = key === "in" ? 0.06 : 0.46;
            return placed.map((entry, index) => {
              const centre = entry.y + Math.max(entry.height, MIN_BAND_H) / 2;
              const step = beat + index * 0.04;
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
                    /* Normalised so one dash covers any bracket, whatever its
                       elbow geometry works out to. */
                    pathLength={1}
                    opacity={revealed ? labelOpacity(entry.band.id) : 0}
                    className={revealed ? "ff-draw transition-opacity" : undefined}
                    style={{ animationDelay: `${step + 0.15}s` }}
                  />
                  <rect
                    x={x}
                    y={entry.y}
                    width={NODE_W}
                    height={Math.max(entry.height, 2)}
                    fill={entry.shade}
                    opacity={revealed ? bandOpacity(entry.band.id) : 0}
                    className={revealed ? "ff-grow transition-opacity" : undefined}
                    style={{
                      transformOrigin: `${x}px ${entry.y + Math.max(entry.height, 2)}px`,
                      animationDelay: `${step}s`,
                    }}
                  />
                  <g
                    className={
                      revealed
                        ? key === "in"
                          ? "ff-slide-in"
                          : "ff-slide-out"
                        : undefined
                    }
                    opacity={revealed ? labelOpacity(entry.band.id) : 0}
                    style={{ animationDelay: `${step + 0.12}s` }}
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
      <p className="mt-2 min-h-[22px] text-[14px] leading-snug font-medium text-[#102a4e]" aria-live="polite">
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
              <span className="ml-2 font-mono text-[9.5px] font-bold tracking-[0.1em] text-faint">
                PINNED · CLICK AGAIN TO RELEASE
              </span>
            )}
          </>
        ) : (
          "Every band is money the annual return itself reports. Hover one to trace it, click to pin."
        )}
      </p>
    </div>

      {/* The reference's bordered note block, on the plate's own ground so it
          reads as part of the figure rather than as body copy. */}
      {(flow.incomeDetail.length > 0 || flow.spendDetail.length > 0) && (
        <div
          className="mt-3 rounded-[5px] border px-4 py-3"
          style={{ borderColor: PLATE_EDGE, backgroundColor: PLATE }}
        >
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {flow.incomeDetail.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5">
                  <h4
                    className="text-[12.5px] font-semibold"
                    style={{ color: FF_INK }}
                  >
                    Included in income
                  </h4>
                  <InfoTooltip content="Already counted in the bands above" />
                </div>
                <ul
                  className="mt-2 space-y-1.5 border-t pt-2"
                  style={{ borderColor: `${FF_RULE}80` }}
                >
                  {flow.incomeDetail.map((source) => (
                    <li
                      key={source.label}
                      className="flex items-baseline justify-between gap-3 text-[12.5px]"
                    >
                      <span style={{ color: FF_DIM }}>{source.label}</span>
                      <span
                        className="font-mono tabular-nums font-medium"
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
                <div className="flex items-center gap-1.5">
                  <h4
                    className="text-[12.5px] font-semibold"
                    style={{ color: FF_INK }}
                  >
                    Included in spending
                  </h4>
                  <InfoTooltip content="Already counted in the bands above" />
                </div>
                <ul
                  className="mt-2 space-y-1.5 border-t pt-2"
                  style={{ borderColor: `${FF_RULE}80` }}
                >
                  {flow.spendDetail.map((use) => (
                    <li
                      key={use.label}
                      className="flex items-baseline justify-between gap-3 text-[12.5px]"
                    >
                      <span style={{ color: FF_DIM }}>
                        {use.label}
                        {use.within && (
                          <span className="text-[11.5px]" style={{ color: FF_FAINT }}>
                            {" "}
                            (inside {use.within})
                          </span>
                        )}
                      </span>
                      <span
                        className="font-mono tabular-nums font-medium"
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
          {Math.max(flow.incomeDrift, flow.spendDrift) > 0.001 && (
            <p
              className="mt-2.5 border-t pt-2 text-[11.5px] leading-[1.5]"
              style={{ borderColor: `${FF_RULE}80`, color: FF_FAINT }}
            >
              The filed lines and the filed totals differ by ${(
                Math.max(flow.incomeDrift, flow.spendDrift) * 100
              ).toFixed(1)}% this year, which is the return restating a figure between the two.
            </p>
          )}
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
    </div>
  );
}
