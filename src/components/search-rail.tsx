import type { ReactNode } from "react";

import { Rise, Stage } from "@/components/dashboard-stage";

/**
 * A page column whose search bar sits beside the heading and stays put when the
 * list under it scrolls.
 *
 * The bar looks like it lives in the heading row, but it cannot actually be in
 * it. `position: sticky` is bounded by its parent's box, so a bar parented to a
 * heading that scrolls off within the first screen unsticks and leaves with it.
 * The bar therefore rides its own rail — an absolutely positioned column the
 * full height of the page — and the heading reserves the width the rail
 * occupies, so the two never overlap and the arrangement reads as one row.
 *
 * The rail also has to live outside `Rise`. `Rise` settles on `filter:
 * blur(0px)`, which opens a stacking context: a `z-50` inside it still cannot
 * paint above the list rows below it, and the search bar's open panel came out
 * clipped behind them. Out here the rail's `z-40` is in the same stacking
 * context as the list and simply wins.
 *
 * The rail is click-through; only the bar inside it takes the pointer.
 */

/**
 * Side-by-side starts at `lg`, not `sm`. The bar is 440px wide, so on the
 * narrower `sm` column the reserved gutter left the h1 a few dozen pixels to
 * wrap into and the heading came out shredded beside it. Below `lg` the bar
 * takes the full column width and the heading sits under it instead.
 */
const BAR_W = "lg:w-[440px]";
const HEADING_RESERVE = "pt-[76px] lg:pt-0 lg:pr-[472px]";

export function SearchRail({
  bar,
  heading,
  headingClassName = "",
  className = "max-w-4xl",
  stageClassName = "",
  children,
}: {
  /** The search bar itself. Rendered inside the sticky rail. */
  bar: ReactNode;
  /** Eyebrow, h1 and blurb. Wrapped in `Rise`, padded clear of the rail. */
  heading: ReactNode;
  headingClassName?: string;
  /** Column width class. */
  className?: string;
  stageClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={`relative mx-auto w-full ${className}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 bottom-0 z-40 lg:top-3">
        <div className="sticky top-4 flex justify-end lg:top-6">
          <div className={`pointer-events-auto w-full ${BAR_W}`}>{bar}</div>
        </div>
      </div>

      <Stage className={stageClassName}>
        <Rise className={`${HEADING_RESERVE} ${headingClassName}`}>{heading}</Rise>
        {children}
      </Stage>
    </div>
  );
}
