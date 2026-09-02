"use client";

/**
 * TEMPORARY — chart selection for the Financials tab. Delete this folder once
 * an option is picked and ported into `fund-flow-sankey.tsx`.
 *
 * Four alternates to the G22 Aggregate Sankey already wired into the app, all
 * drawing one filed year of one real charity so the comparison is fair.
 *
 * Mono throughout (`lieflat-charts/mono-tokens.js`): paper and ink, a 7-step
 * ladder, lightness carrying size, deterministic jitter, thin marks.
 */

const INK = "#1C1C1A";
const MUTED = "#8F8E88";
const FAINT = "#C6C5BF";
const GRID = "#DEDDD6";
const PAPER = "#F0EFEB";
const LAD = ["#1C1C1A", "#4A4944", "#6A6963", "#8F8E88", "#B0AFA9", "#C6C5BF", "#D8D7D1"];

export type Line = { label: string; amount: number };

/** The app's compact formatter, restated here so this throwaway page has no
 *  reason to reach into product code it might outlive. */
function gbp(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}£${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (abs >= 1_000) return `${sign}£${Math.round(abs / 1_000)}k`;
  return `${sign}£${abs.toLocaleString("en-GB")}`;
}

/** Deterministic jitter. Rung widths must survive a reload unchanged, or a
 *  screenshot taken today stops matching one taken tomorrow. */
const rnd = (i: number, k: number) =>
  Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;

const CAPTION = {
  fontSize: 7,
  fontWeight: 600,
  fill: FAINT,
  letterSpacing: "0.12em",
} as const;

/**
 * Whole units that still sum to the whole.
 *
 * Largest-remainder rather than per-line rounding: in a flow diagram the
 * strands have to be conserved, and rounding each line on its own leaves the
 * two sides of the year disagreeing about how many strands exist.
 */
function allocate(values: number[], total: number): number[] {
  const raw = values.map((v) => (v / values.reduce((a, b) => a + b, 0)) * total);
  const floors = raw.map(Math.floor);
  let short = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem);
  const out = [...floors];
  for (const { i } of order) {
    if (short <= 0) break;
    out[i] += 1;
    short -= 1;
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   B · F7 Stacked Rungs — two ladders counted in £50,000 rungs
   ═══════════════════════════════════════════════════════════════════════ */

export function StackedRungs({
  income,
  spend,
}: {
  income: Line[];
  spend: Line[];
}) {
  const UNIT = 50_000;
  const STEP = 3.4;
  const BASE = 330;
  const HW = 30;
  const W = 760;
  const H = 400;

  const incomeTotal = income.reduce((a, l) => a + l.amount, 0);
  const spendTotal = spend.reduce((a, l) => a + l.amount, 0);
  const surplus = incomeTotal - spendTotal;

  function tower(cx: number, lines: Line[], title: string, total: number) {
    const marks: React.ReactNode[] = [];
    let k0 = 0;
    lines.forEach((line, si) => {
      const n = Math.round(line.amount / UNIT);
      for (let k = 0; k < n; k++) {
        const y = BASE - (k0 + k + si * 1.4) * STEP;
        const w = HW - 3 + rnd(k + 1, si * 3 + 2) * 6;
        marks.push(
          <line
            key={`r-${si}-${k}`}
            x1={cx - w}
            y1={y}
            x2={cx + w}
            y2={y}
            stroke={LAD[Math.min(si, 5)]}
            strokeWidth={1.1}
            opacity={0.62 + rnd(k + 2, si + 4) * 0.38}
          />,
        );
      }
      // A line smaller than one rung still gets its name and its number — the
      // rung count is what rounds, never the label.
      const midY = BASE - (k0 + Math.max(n, 1) / 2 + si * 1.4) * STEP;
      marks.push(
        <text
          key={`l-${si}`}
          x={cx + HW + 10}
          y={midY + 1}
          fontSize={8}
          fontWeight={700}
          letterSpacing="0.04em"
          fill={LAD[2]}
        >
          {line.label.toUpperCase()}
          {n === 0 ? " · UNDER ONE RUNG" : ""}
        </text>,
        <text
          key={`v-${si}`}
          x={cx + HW + 10}
          y={midY + 11}
          fontSize={9.5}
          fontWeight={800}
          fill={INK}
        >
          {gbp(line.amount)}
        </text>,
      );
      k0 += n;
    });
    const topY = BASE - (k0 + lines.length * 1.4) * STEP;
    marks.push(
      <text
        key="total"
        x={cx}
        y={topY - 14}
        textAnchor="middle"
        fontSize={13}
        fontWeight={800}
        fill={INK}
      >
        {gbp(total)}
      </text>,
      <text
        key="name"
        x={cx}
        y={BASE + 20}
        textAnchor="middle"
        fontSize={8}
        fontWeight={700}
        letterSpacing="0.1em"
        fill={MUTED}
      >
        {title}
      </text>,
    );
    return { marks, topY };
  }

  const left = tower(120, income, "INCOME", incomeTotal);
  const right = tower(455, spend, "SPENDING", spendTotal);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label={`Two stacked ladders in £50,000 rungs. Income ${gbp(incomeTotal)} against spending ${gbp(spendTotal)}, leaving ${gbp(surplus)} kept.`}>
      {left.marks}
      {right.marks}

      {/* The surplus is the gap between the towers, so it is drawn as that gap
          rather than asserted as a third bar. */}
      <line x1={150} x2={700} y1={left.topY} y2={left.topY} stroke={FAINT} strokeWidth={0.7} strokeDasharray="2 3" />
      <line x1={485} x2={700} y1={right.topY} y2={right.topY} stroke={FAINT} strokeWidth={0.7} strokeDasharray="2 3" />
      <line x1={690} x2={690} y1={left.topY} y2={right.topY} stroke={INK} strokeWidth={1.4} />
      <text x={700} y={(left.topY + right.topY) / 2 - 2} fontSize={8} fontWeight={700} letterSpacing="0.06em" fill={LAD[2]}>
        KEPT
      </text>
      <text x={700} y={(left.topY + right.topY) / 2 + 9} fontSize={10.5} fontWeight={800} fill={INK}>
        {gbp(surplus)}
      </text>

      <line x1={40} x2={W - 40} y1={BASE + 5} y2={BASE + 5} stroke={GRID} strokeWidth={0.8} />
      <text {...CAPTION} x={W / 2} y={H - 10} textAnchor="middle">
        ONE RUNG = £50,000 · DARKEST = LARGEST LINE
      </text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   C · F9 Rung Waterfall — income, less each spending line, to the surplus
   ═══════════════════════════════════════════════════════════════════════ */

export function RungWaterfall({
  income,
  spend,
}: {
  income: Line[];
  spend: Line[];
}) {
  const UNIT = 50_000;
  const STEP = 3.4;
  const BASE = 330;
  const HW = 40;
  const W = 760;
  const H = 400;

  const incomeTotal = income.reduce((a, l) => a + l.amount, 0);
  const spendTotal = spend.reduce((a, l) => a + l.amount, 0);
  const surplus = incomeTotal - spendTotal;

  const steps = [
    { name: "INCOME", value: incomeTotal, total: true },
    ...spend.map((l) => ({ name: l.label.toUpperCase(), value: -l.amount, total: false })),
    { name: "KEPT", value: surplus, total: true },
  ];

  const x0 = (i: number) => 130 + i * (500 / Math.max(1, steps.length - 1));
  const yOf = (k: number) => BASE - k * STEP;

  const marks: React.ReactNode[] = [];
  let level = 0;
  steps.forEach((step, i) => {
    const neg = !step.total;
    const rungs = Math.round(Math.abs(step.value) / UNIT);
    const from = neg ? level - rungs : 0;
    const to = neg ? level : rungs;
    const x = x0(i);

    for (let k = 0; k < Math.abs(to - from); k++) {
      const y = yOf(Math.min(from, to) + k);
      const w = HW - 4 + rnd(k + 1, i + 2) * 8;
      marks.push(
        neg ? (
          <line key={`w-${i}-${k}`} x1={x - w} y1={y} x2={x + w} y2={y}
            stroke={LAD[3]} strokeWidth={1.1} strokeDasharray="2.5 2.5" opacity={0.75} />
        ) : (
          <line key={`w-${i}-${k}`} x1={x - w} y1={y} x2={x + w} y2={y}
            stroke={INK} strokeWidth={1.1} opacity={0.62 + rnd(k + 2, i + 4) * 0.38} />
        ),
      );
    }

    const landing = neg ? from : to;
    if (i < steps.length - 1) {
      marks.push(
        <line key={`h-${i}`} x1={x + HW + 6} y1={yOf(landing)} x2={x0(i + 1) - HW - 6}
          y2={yOf(landing)} stroke={FAINT} strokeWidth={0.7} strokeDasharray="2 3" />,
      );
    }

    marks.push(
      <text key={`n-${i}`} x={x} y={yOf(Math.max(from, to)) - 10} textAnchor="middle"
        fontSize={12} fontWeight={800} fill={neg ? LAD[3] : INK}>
        {(neg ? "−" : "") + gbp(Math.abs(step.value))}
      </text>,
      <text key={`c-${i}`} x={x} y={BASE + 20} textAnchor="middle" fontSize={8}
        fontWeight={700} letterSpacing="0.08em" fill={MUTED}>
        {step.name}
      </text>,
    );

    if (neg) level = from;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label={`Waterfall in £50,000 rungs. Income ${gbp(incomeTotal)}, less spending, leaving ${gbp(surplus)} kept.`}>
      {marks}
      <line x1={40} x2={W - 40} y1={BASE + 5} y2={BASE + 5} stroke={GRID} strokeWidth={0.8} />
      <text {...CAPTION} x={W / 2} y={H - 10} textAnchor="middle">
        SOLID RUNGS ADD · DASHED RUNGS TAKE AWAY · ONE RUNG = £50,000
      </text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   D · L13 Hourglass Stream — the year as two barcode strips
   ═══════════════════════════════════════════════════════════════════════ */

export function HourglassStream({
  income,
  spend,
}: {
  income: Line[];
  spend: Line[];
}) {
  const UNIT = 50_000;
  const W = 760;
  const H = 400;
  const CX = 300;
  const MAXW = 440;

  const incomeTotal = income.reduce((a, l) => a + l.amount, 0);
  const spendTotal = spend.reduce((a, l) => a + l.amount, 0);
  const surplus = incomeTotal - spendTotal;

  const wOf = (v: number) => (v / incomeTotal) * MAXW;
  const strips = [
    { y: 92, lines: income, total: incomeTotal, name: "CAME IN" },
    { y: 288, lines: spend, total: spendTotal, name: "WENT OUT" },
  ];

  const marks: React.ReactNode[] = [];

  strips.forEach((strip, si) => {
    const hw = wOf(strip.total) / 2;
    let cursor = CX - hw;

    strip.lines.forEach((line, li) => {
      const segW = wOf(line.amount);
      const n = Math.max(1, Math.round(line.amount / UNIT));
      for (let t = 0; t < n; t++) {
        const x = cursor + ((t + 0.5) / n) * segW + (rnd(t + 1, li + 3) - 0.5) * 2.2;
        marks.push(
          <line key={`t-${si}-${li}-${t}`} x1={x} y1={strip.y - 15} x2={x} y2={strip.y + 15}
            stroke={LAD[Math.min(li, 5)]} strokeWidth={0.9}
            opacity={0.5 + rnd(t + 2, li + 5) * 0.5} />,
        );
      }
      // A boundary inside a barcode is otherwise invisible, so it is cut with
      // the paper colour rather than drawn as another line.
      if (li > 0) {
        marks.push(
          <line key={`b-${si}-${li}`} x1={cursor - 1} y1={strip.y - 19} x2={cursor - 1}
            y2={strip.y + 19} stroke={PAPER} strokeWidth={2.4} />,
        );
      }
      // Only a segment wide enough to hold its own name gets one inline.
      if (segW > 78) {
        marks.push(
          <text key={`sl-${si}-${li}`} x={cursor + segW / 2} y={strip.y + 32}
            textAnchor="middle" fontSize={7} fontWeight={700} letterSpacing="0.06em" fill={LAD[2]}>
            {line.label.toUpperCase()}
          </text>,
          <text key={`sv-${si}-${li}`} x={cursor + segW / 2} y={strip.y + 42}
            textAnchor="middle" fontSize={8.5} fontWeight={800} fill={INK}>
            {gbp(line.amount)}
          </text>,
        );
      }
      cursor += segW;
    });

    marks.push(
      <line key={`rule-${si}`} x1={CX + hw + 8} y1={strip.y} x2={620} y2={strip.y}
        stroke={GRID} strokeWidth={0.8} />,
      <text key={`nm-${si}`} x={628} y={strip.y - 2} fontSize={8} fontWeight={700}
        letterSpacing="0.1em" fill={LAD[2]}>
        {strip.name}
      </text>,
      <text key={`tv-${si}`} x={628} y={strip.y + 12} fontSize={12} fontWeight={800} fill={INK}>
        {gbp(strip.total)}
      </text>,
    );
  });

  // Threads are texture, not records — said out loud in the caption.
  const hwTop = wOf(incomeTotal) / 2;
  const hwBot = wOf(spendTotal) / 2;
  const threads: React.ReactNode[] = [];
  for (let t = 0; t < 40; t++) {
    const xt = CX + (rnd(t + 1, 11) - 0.5) * 2 * hwTop * 0.95;
    const xb = CX + (rnd(t + 3, 17) - 0.5) * 2 * hwBot * 0.95;
    threads.push(
      <path key={`th-${t}`}
        d={`M${xt} ${strips[0].y + 48} C${xt} ${strips[0].y + 110} ${xb} ${strips[1].y - 90} ${xb} ${strips[1].y - 22}`}
        fill="none" stroke={LAD[4]} strokeWidth={0.5} opacity={0.34} />,
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label={`Two barcode strips in £50,000 ticks. Income ${gbp(incomeTotal)} narrowing to spending ${gbp(spendTotal)}, the difference being ${gbp(surplus)} kept.`}>
      {threads}
      {marks}
      <text x={60} y={196} fontSize={13} fontWeight={800} fill={INK}>{gbp(surplus)}</text>
      <text x={60} y={208} fontSize={6.5} fontWeight={600} letterSpacing="0.1em" fill={MUTED}>
        KEPT — THE
      </text>
      <text x={60} y={218} fontSize={6.5} fontWeight={600} letterSpacing="0.1em" fill={MUTED}>
        NARROWING
      </text>
      <text {...CAPTION} x={W / 2} y={H - 10} textAnchor="middle">
        ONE TICK = £50,000 · STRIP WIDTH = POUNDS · THREADS ARE TEXTURE, NOT RECORDS
      </text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   E · Strand Sankey — built from the principles, not from a template
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A Sankey the library does not have, composed the way the skill's §6 says to
 * compose one: answer the ontology first, borrow the nearest relatives'
 * grammar, and build only from Mono tokens.
 *
 * **The ontology.** Every channel carries something, or it is not drawn.
 *   Strand count  → pounds, at £50,000 each. Not width — *count*.
 *   Horizontal    → direction: came in, pooled, went out.
 *   Vertical      → grouping only; there is no y quantity in a flow.
 *   Lightness     → rank by size, so the biggest line is the darkest.
 *   Dashes        → money that was not spent, borrowed from F9's grammar
 *                   where dashed rungs take away.
 *   Curvature     → nothing. It is the shortest legible join and says so.
 *
 * **The departure from G22.** A template Sankey draws a solid ribbon and asks
 * you to trust its width. The Lupi move — the one thing this library does that
 * others do not — is to refuse the smooth aggregate and hand back countable
 * units. So the ribbon is dissolved into strands: ninety of them, one per
 * £50,000, and a reader who doubts the picture can count them against the
 * table. Width still reads at a glance because ninety hairlines at this pitch
 * *are* a width; the difference is that the width is now evidence rather than
 * an assertion.
 *
 * **Strands are conserved.** Both sides allocate the same ninety by largest
 * remainder, so no strand is created or destroyed crossing the pot. That is
 * the whole contract of a flow diagram and per-line rounding quietly breaks it.
 *
 * **The furniture.** Sparse data, dense environment: a rim scale every ten
 * strands (£500,000), a ledger rule under each column, and the pot drawn as an
 * open bracket rather than a solid block — it is a place money passes through,
 * and a filled rectangle claims it is a thing.
 */
export function StrandSankey({
  income,
  spend,
}: {
  income: Line[];
  spend: Line[];
}) {
  const UNIT = 50_000;
  const W = 760;
  const H = 420;
  const TOP = 34;
  const BOT = H - 58;
  const XL = 208;
  const XR = W - 208;
  const POT_W = 26;
  const POT_X = W / 2 - POT_W / 2;
  /** Breathing room between one line's strands and the next. */
  const GROUP_GAP = 9;

  const incomeTotal = income.reduce((a, l) => a + l.amount, 0);
  const spendTotal = spend.reduce((a, l) => a + l.amount, 0);
  const surplus = incomeTotal - spendTotal;

  const TOTAL = Math.round(incomeTotal / UNIT);

  const outLines: (Line & { unspent?: boolean })[] = [
    ...spend,
    { label: "Kept for the year", amount: surplus, unspent: true },
  ];

  const inCounts = allocate(income.map((l) => l.amount), TOTAL);
  const outCounts = allocate(outLines.map((l) => l.amount), TOTAL);

  /** Strand slots down a column, grouped with a gap between lines. */
  function slots(counts: number[]) {
    const groups = counts.filter((c) => c > 0).length;
    const span = BOT - TOP - GROUP_GAP * Math.max(0, groups - 1);
    const pitch = span / TOTAL;
    const out: { y: number; group: number; indexInGroup: number }[] = [];
    let y = TOP;
    let drawnGroups = 0;
    counts.forEach((count, g) => {
      if (count > 0 && drawnGroups > 0) y += GROUP_GAP;
      if (count > 0) drawnGroups += 1;
      for (let k = 0; k < count; k++) {
        out.push({ y: y + pitch / 2, group: g, indexInGroup: k });
        y += pitch;
      }
    });
    return { list: out, pitch };
  }

  const inSlots = slots(inCounts);
  const outSlots = slots(outCounts);
  /** The pot is contiguous — no gaps, because inside it the money is one pool. */
  const potPitch = (BOT - TOP) / TOTAL;
  const potY = (k: number) => TOP + potPitch * (k + 0.5);

  const strandPath = (x0: number, y0: number, x1: number, y1: number) => {
    const m = (x0 + x1) / 2;
    return `M${x0} ${y0} C${m} ${y0} ${m} ${y1} ${x1} ${y1}`;
  };

  const strands: React.ReactNode[] = [];
  for (let k = 0; k < TOTAL; k++) {
    const a = inSlots.list[k];
    const b = outSlots.list[k];
    if (!a || !b) continue;
    const unspent = outLines[b.group]?.unspent === true;
    const shadeIn = LAD[Math.min(a.group, 5)];
    const shadeOut = unspent ? LAD[4] : LAD[Math.min(b.group, 5)];
    const wobble = (rnd(k + 1, a.group + 2) - 0.5) * 1.4;

    strands.push(
      <path key={`si-${k}`} d={strandPath(XL, a.y + wobble, POT_X, potY(k))}
        fill="none" stroke={shadeIn} strokeWidth={0.75}
        opacity={0.5 + rnd(k + 2, a.group + 4) * 0.45} />,
      <path key={`so-${k}`} d={strandPath(POT_X + POT_W, potY(k), XR, b.y + wobble)}
        fill="none" stroke={shadeOut} strokeWidth={0.75}
        strokeDasharray={unspent ? "2.5 2.5" : undefined}
        opacity={0.5 + rnd(k + 3, b.group + 6) * 0.45} />,
    );
  }

  /** Column labels, anchored to the middle of each line's strand group. */
  function columnLabels(
    lines: (Line & { unspent?: boolean })[],
    counts: number[],
    placed: { y: number; group: number }[],
    x: number,
    anchor: "end" | "start",
  ) {
    return lines.map((line, g) => {
      const mine = placed.filter((s) => s.group === g);
      if (mine.length === 0) {
        return null; // under one strand — the table carries it
      }
      const mid = (mine[0].y + mine[mine.length - 1].y) / 2;
      const lx = anchor === "end" ? x - 12 : x + 12;
      return (
        <g key={`lab-${anchor}-${g}`}>
          <text x={lx} y={mid - 1} textAnchor={anchor} fontSize={7.5} fontWeight={700}
            letterSpacing="0.05em" fill={LAD[1]}>
            {line.label.toUpperCase()}
          </text>
          <text x={lx} y={mid + 10} textAnchor={anchor} fontSize={10} fontWeight={800} fill={INK}>
            {gbp(line.amount)}
          </text>
          <text x={lx} y={mid + 19} textAnchor={anchor} fontSize={6.5} fontWeight={600}
            letterSpacing="0.08em" fill={FAINT}>
            {counts[g]} STRAND{counts[g] === 1 ? "" : "S"}
          </text>
        </g>
      );
    });
  }

  /** Rim scale: a tick every ten strands, which is £500,000 of real money. */
  const rim: React.ReactNode[] = [];
  for (let k = 0; k <= TOTAL; k += 10) {
    const y = TOP + potPitch * k;
    rim.push(
      <line key={`rim-${k}`} x1={POT_X - 5} y1={y} x2={POT_X - 1} y2={y}
        stroke={FAINT} strokeWidth={0.6} />,
      <text key={`rimv-${k}`} x={POT_X - 8} y={y + 2.4} textAnchor="end" fontSize={5.5}
        fontWeight={600} fill={FAINT} letterSpacing="0.04em">
        {gbp(k * UNIT)}
      </text>,
    );
  }

  const missing = income.filter((l, i) => inCounts[i] === 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label={`Strand Sankey. ${TOTAL} strands of £50,000 flow from six income lines through one pot into spending of ${gbp(spendTotal)} and ${gbp(surplus)} kept.`}>
      {strands}
      {rim}

      {/* The pot as an open bracket, not a filled block: money passes through
          it, and a solid rectangle would claim it is a thing in its own right. */}
      <path d={`M${POT_X + 7} ${TOP - 6} L${POT_X} ${TOP - 6} L${POT_X} ${BOT + 6} L${POT_X + 7} ${BOT + 6}`}
        fill="none" stroke={INK} strokeWidth={1.4} />
      <path d={`M${POT_X + POT_W - 7} ${TOP - 6} L${POT_X + POT_W} ${TOP - 6} L${POT_X + POT_W} ${BOT + 6} L${POT_X + POT_W - 7} ${BOT + 6}`}
        fill="none" stroke={INK} strokeWidth={1.4} />
      <text x={W / 2} y={TOP - 14} textAnchor="middle" fontSize={7} fontWeight={600}
        letterSpacing="0.12em" fill={MUTED}>
        ONE POT · {TOTAL} STRANDS · {gbp(incomeTotal)}
      </text>

      {columnLabels(income, inCounts, inSlots.list, XL, "end")}
      {columnLabels(outLines, outCounts, outSlots.list, XR, "start")}

      <line x1={24} x2={W - 24} y1={BOT + 24} y2={BOT + 24} stroke={GRID} strokeWidth={0.8} />
      <text {...CAPTION} x={24} y={BOT + 38}>CAME IN</text>
      <text {...CAPTION} x={W - 24} y={BOT + 38} textAnchor="end">WENT OUT</text>
      <text {...CAPTION} x={W / 2} y={H - 8} textAnchor="middle">
        ONE STRAND = £50,000 · DASHED = NOT SPENT · SHADE = RANK BY SIZE
      </text>
      {missing.length > 0 && (
        <text x={24} y={BOT + 50} fontSize={6.5} fontWeight={600} fill={FAINT} letterSpacing="0.04em">
          {missing.map((l) => `${l.label} ${gbp(l.amount)}`).join(" · ")} — under one strand, see the table
        </text>
      )}
    </svg>
  );
}
