/**
 * Geometry for the funnel stream — the ribbon that runs across the pipeline
 * report card. Pure, and separate from the component, so the shape can be
 * checked without a browser.
 *
 * The stream is four nested ribbons on one centre line, one per stage. Ribbon
 * `k` is as thick as its own stage until the funnel narrows past it, and then
 * follows the funnel down:
 *
 *     half thickness of ribbon k at stage j  ∝  count[max(j, k)]
 *
 * So at the left edge the four ribbons are separated by exactly the drop-off
 * between stages, and by the right edge they have all converged onto the
 * converted count. What you see peeling away between the bands *is* the loss at
 * each step — the picture cannot disagree with the numbers, because it is
 * drawn from them.
 */

export type StreamRibbon = {
  /** Index of the stage this ribbon belongs to, outermost (0) first. */
  stage: number;
  path: string;
};

export type StreamGeometry = {
  ribbons: StreamRibbon[];
  /** Where each stage's marker line sits, as a 0–1 fraction of the width. */
  markers: number[];
};

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A horizontal cubic through the points, with control handles halfway between
 * neighbours. Flat handles (same y as their anchor) keep the curve from
 * overshooting into a bulge on a steep drop, which on a funnel would draw a
 * stage as bigger than it is.
 */
function curveThrough(points: { x: number; y: number }[]): string {
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const mid = (to.x - from.x) / 2;
    d += ` C ${round(from.x + mid)} ${round(from.y)} ${round(to.x - mid)} ${round(to.y)} ${round(to.x)} ${round(to.y)}`;
  }
  return d;
}

/**
 * @param counts   Stage counts, widest first. Four of them on this page, but the
 *                 maths doesn't care how many.
 * @param width    Viewbox width.
 * @param height   Viewbox height.
 * @param inset    Fraction of the width before the first marker and after the
 *                 last, where the stream runs flat — the reference card's stream
 *                 bleeds off both edges rather than starting and stopping.
 */
export function funnelStream(
  counts: number[],
  { width = 1000, height = 260, inset = 0.09, padding = 10 } = {},
): StreamGeometry {
  const centre = height / 2;
  const maxHalf = Math.max(height / 2 - padding, 0);
  const total = counts[0] ?? 0;
  const scale = total > 0 ? maxHalf / total : 0;

  const markers = counts.map((_, index) =>
    counts.length === 1 ? 0.5 : inset + (index * (1 - 2 * inset)) / (counts.length - 1),
  );
  const xs = markers.map((fraction) => fraction * width);

  const ribbons = counts.map((_, stage) => {
    // A stage with nothing in it draws no ribbon at all rather than a hairline
    // that would read as "a few".
    const halves = counts.map((_, j) => scale * counts[Math.max(j, stage)]);

    const top = [
      { x: 0, y: centre - halves[0] },
      ...xs.map((x, j) => ({ x, y: centre - halves[j] })),
      { x: width, y: centre - halves[halves.length - 1] },
    ];
    const bottom = [...top].reverse().map((point) => ({ x: point.x, y: 2 * centre - point.y }));

    // The mirrored curve starts where the top curve ended, so its `M` becomes an
    // `L` down the right-hand edge and the two halves close into one shape.
    return { stage, path: `${curveThrough(top)} ${curveThrough(bottom).replace(/^M/, "L")} Z` };
  });

  return { ribbons, markers };
}
