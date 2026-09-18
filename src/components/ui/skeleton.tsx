/**
 * F234. Shared loading-skeleton primitives.
 *
 * These exist because the app's skeletons drifted: each route's `loading.tsx`
 * hand-rolled the page shell it was mirroring, and the redesigns moved the pages
 * on without them — so a loading frame could paint a 28px-radius grey slab where
 * the page now renders a white 10px-radius card, and the swap read as a flash
 * rather than a fade. Anything that has to be identical to the real page lives
 * here once, so a route's skeleton is its *content* and not its geometry.
 *
 * The rule for every primitive: **the same box the page draws, with bars where
 * the words go.** Same ground, same container, same radius, same border, same
 * padding, same line-box heights (a bar is one line tall, not one "size" tall).
 * A skeleton that is merely similar is worse than none, because the difference
 * is what the eye catches.
 *
 * Two card languages are in play while the app is mid-migration, and a skeleton
 * must match the page it belongs to — never the file next to it:
 *
 * - `SkeletonCard`, `SkeletonListPanel` (default) and `SkeletonTable` — the old
 *   language: `rounded-2xl border-black/[0.06] shadow-sm`. Still what most of
 *   `/admin/*`, the analytics screens and the client list use.
 * - `SkeletonPanel`, `SkeletonSectionCard`, `SkeletonFactRows` — the Filed Record
 *   language: `rounded-panel border-rule bg-white`, no shadow. The client record,
 *   the converted admin cards and the register screens.
 *
 * Bars are `bg-black/10`, which is what the hand-rolled skeletons already used
 * and what the shadowed cards need; on a `--rule` card it reads as a placeholder
 * rather than as content, which is the point. A card whose fill is white keeps
 * that fill and gets bars *inside* it — a grey block the size of a card is the
 * one thing a loading frame must never draw, because the page will paint a white
 * card there and the difference flashes.
 *
 * The exports, and what each is for:
 *
 * - `Skeleton` — one bar. Never nest it inside a pulse wrapper; it animates
 *   alone.
 * - `SkeletonLine` — a bar sized to a line of *text*, for headings whose
 *   font-size is a clamp.
 * - `SkeletonCard` / `SkeletonPanel` / `SkeletonSectionCard` — the three card
 *   shells above, the last with a title and hint line box.
 * - `SkeletonListPanel` / `SkeletonTable` — a card of divided rows, and a card
 *   holding a table.
 * - `SkeletonFactRows` / `SkeletonStatGrid` / `SkeletonStatCard` — the record's
 *   label-over-value rows, a grid of readings, and the old metric tile.
 * - `SkeletonPriorityDial` / `SkeletonRecordHeader` — the client record's header
 *   and the dial at its end, for the layout's Suspense boundary.
 */
import type { ReactNode } from "react";

/** One placeholder bar. Animates on its own — never nest it in a pulse wrapper. */
export function Skeleton({
  className = "",
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded bg-black/10 ${className}`}
      {...props}
    />
  );
}

/**
 * A bar sized to a line of text rather than to a number: `h-[1em]` with the
 * real font-size and `leading-none` reproduces the line box the text will take,
 * at every breakpoint, without hard-coding pixels. Use for headings whose
 * font-size is a clamp.
 */
export function SkeletonLine({
  className = "",
  text = "text-base",
  width = "w-48",
}: {
  className?: string;
  /** The font-size class the real text carries, e.g. `text-[clamp(2rem,4vw,2.75rem)]`. */
  text?: string;
  width?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block h-[1em] animate-pulse rounded bg-black/10 leading-none ${text} ${width} ${className}`}
    />
  );
}

/**
 * A section heading: the `text-xl` h2 the dashboard and list screens use, with
 * the optional right-hand caption some sections carry.
 */
export function SkeletonSectionHeading({
  width = "w-40",
  captionWidth,
  className = "",
}: {
  width?: string;
  /** Width of the right-aligned meta line, if the section has one. */
  captionWidth?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${className}`}>
      <Skeleton className={`h-7 ${width}`} />
      {captionWidth && (
        <Skeleton className={`hidden h-3 shrink-0 sm:block ${captionWidth}`} />
      )}
    </div>
  );
}

/** The old card: `rounded-2xl border-black/[0.06] shadow-sm`. */
export function SkeletonCard({
  className = "",
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The Filed Record card: `rounded-panel border-rule bg-white`, no shadow.
 * Padding matches `SectionCard` (`px-5 py-4.5`).
 */
export function SkeletonPanel({
  className = "",
  padded = true,
  children,
}: {
  className?: string;
  /** Set false when the caller supplies its own padding (e.g. flush list rows). */
  padded?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-panel border border-rule bg-white ${padded ? "px-5 py-4.5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The client record's `SectionCard`: `rounded-panel border-rule bg-white` at
 * `px-5 py-4.5`, with a title at `text-[18px] leading-[1.3]` and an optional
 * `text-[13px] leading-[1.55]` hint under it — the two line boxes measured, not
 * guessed, so the cards below do not shift when the real titles arrive.
 *
 * `action` draws the pill `SectionCard` pins to the heading row's right edge;
 * `numbered` leaves room for the serif numeral the Financials cards carry.
 */
export function SkeletonSectionCard({
  titleWidth = "w-40",
  titleHeight = "h-[23px]",
  hintWidth,
  action = false,
  actionClassName = "",
  numbered = false,
  padded = true,
  className = "",
  children,
}: {
  titleWidth?: string;
  /** Line box of the card's title. 23px is `text-[18px] leading-[1.3]`. */
  titleHeight?: string;
  /** Width of the single hint line. Omitted draws no hint. */
  hintWidth?: string;
  action?: boolean;
  /**
   * The action bar's box. The default is a pill (`h-8 w-28 rounded-full`); a card
   * whose right-hand control is a page-size select, on its own or beside a pill,
   * passes its own width so the heading row does not jump when the card arrives.
   */
  actionClassName?: string;
  numbered?: boolean;
  /** Set false when the caller supplies its own padding (e.g. flush list rows). */
  padded?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-hidden="true"
      className={`overflow-hidden rounded-panel border border-rule bg-white ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            {numbered && <Skeleton className="h-[24px] w-4 shrink-0" />}
            <Skeleton className={`${titleHeight} ${titleWidth} max-w-full`} />
          </div>
          {hintWidth && <Skeleton className={`mt-1 h-5 ${hintWidth} max-w-full`} />}
        </div>
        {action && (
          <Skeleton
            className={`shrink-0 rounded-full ${actionClassName || "h-8 w-28"}`}
          />
        )}
      </div>
      {/* Padding matches `SectionCard` (`px-5 py-4.5`) when padded; flush when the
          caller brings its own row padding, as the tab bodies do. */}
      <div className={padded ? "px-5 pb-4.5" : ""}>{children}</div>
    </section>
  );
}

/**
 * The record's label-over-value rows: an 18px glyph column, the label and value
 * stacked, and a trailing pill — the shape Basic information and Contactability
 * both use. `divider` adds the `border-rule-soft` rule the second and later rows
 * carry.
 */
export function SkeletonFactRows({
  rows = 3,
  divider = true,
  className = "mt-3.5 flex flex-col",
}: {
  rows?: number;
  /** Draw the hairline above every row but the first, as the real bodies do. */
  divider?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className={`grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3 ${
            divider && index > 0 ? "border-t border-rule-soft" : ""
          }`}
        >
          <Skeleton className="mt-0.5 size-4" />
          <div className="min-w-0">
            <Skeleton className="h-[17px] w-20" />
            <Skeleton className="mt-1 h-5 w-48 max-w-full" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * A grid of label-over-reading-over-caption cells — the Financial scale and
 * Score breakdown shape. Bar heights follow the real type: a 22px reading and a
 * 12.5px caption.
 */
export function SkeletonStatGrid({
  cells = 2,
  className = "mt-4 grid grid-cols-2 gap-x-6 gap-y-4",
}: {
  cells?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: cells }).map((_, index) => (
        <div key={index}>
          <Skeleton className="h-4 w-20 max-w-full" />
          <Skeleton className="mt-1.5 h-7 w-24 max-w-full" />
          <Skeleton className="mt-1 h-4 w-28 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/** A white card holding `rows` divide-y list rows. `panel` picks the card language. */
export function SkeletonListPanel({
  rows = 5,
  className = "",
  panel = false,
  rowClassName = "",
}: {
  rows?: number;
  className?: string;
  /** `true` for `rounded-panel border-rule`, `false` for the old `rounded-2xl`. */
  panel?: boolean;
  rowClassName?: string;
}) {
  const chrome = panel
    ? "rounded-panel border border-rule bg-white"
    : "rounded-2xl border border-black/[0.06] bg-white shadow-sm";
  const divider = panel ? "divide-rule-soft" : "divide-black/[0.06]";

  return (
    <div className={`overflow-hidden ${chrome} ${className}`} aria-hidden="true">
      <ul className={`divide-y ${divider}`}>
        {Array.from({ length: rows }).map((_, index) => (
          <li
            key={index}
            className={`flex items-center justify-between gap-4 px-5 py-4 ${rowClassName}`}
          >
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-20 rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A table card: the header row and `rows` body rows, `columns` wide. Mirrors
 * the app's border-collapse tables (border-b between rows, `p-4` cells).
 */
export function SkeletonTable({
  rows = 6,
  columns = 3,
  className = "",
  lastColumnRight = true,
}: {
  rows?: number;
  columns?: number;
  className?: string;
  lastColumnRight?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm ${className}`}
    >
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black/10">
            {Array.from({ length: columns }).map((_, index) => (
              <th key={index} className="p-4 pb-3">
                <Skeleton
                  className={`h-3 w-16 ${lastColumnRight && index > 0 ? "ml-auto" : ""}`}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex} className="border-b border-black/5 last:border-b-0">
              {Array.from({ length: columns }).map((_, index) => (
                <td key={index} className="p-4">
                  <Skeleton
                    className={`h-4 ${index === 0 ? "w-40" : "w-12"} ${
                      lastColumnRight && index > 0 ? "ml-auto" : ""
                    }`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The priority dial that sits at the end of a client record's header — a
 * `w-[210px]` column widening to `w-[290px]` at xl, all of it shrink-proof. The
 * circle is drawn as a ring so it reads as a dial rather than as a filled disc.
 */
export function SkeletonPriorityDial({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`flex w-[210px] max-w-full shrink-0 flex-col items-center sm:w-[230px] md:w-[250px] lg:w-[275px] xl:w-[290px] ${className}`}
    >
      <Skeleton className="size-[190px] rounded-full sm:size-[210px]" />
      <Skeleton className="mt-3 h-4 w-40" />
    </div>
  );
}

/**
 * The client record's header, shape for shape: the top bar with its register key,
 * the h1 at `clamp(2rem,4vw,2.75rem)`, the location and chip rows, the mission
 * quote box, the priority dial at the end, and the `Stage`/status bar along the
 * bottom.
 *
 * This replaces a fixed-height empty white slab (`h-[21rem] … sm:h-[17rem]`)
 * inside the layout's Suspense boundary. The height was measured correctly — the
 * tab bar underneath does not jump — but the box showed nothing, so the record
 * arrived onto a blank white card where its name and status should have been
 * drafting in. The page's own geometry is used instead of a remembered height,
 * so the two cannot drift apart.
 */
export function SkeletonRecordHeader({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`relative rounded-panel border border-rule bg-white ${className}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-rule-soft px-5 py-2.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-24 rounded-inset" />
          <Skeleton className="h-7 w-20 rounded-inset" />
        </div>
        <Skeleton className="h-7 w-28 shrink-0 rounded-inset" />
      </div>

      <div className="grid items-start gap-x-8 gap-y-4 px-5 pt-5 pb-1 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          <Skeleton className="h-[1em] w-3/4 max-w-full text-[clamp(2rem,4vw,2.75rem)] leading-none" />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="flex flex-wrap gap-2">
            {["w-24", "w-28", "w-20"].map((width, index) => (
              <Skeleton key={index} className={`h-7 rounded-full ${width}`} />
            ))}
          </div>
          <div className="mt-2 max-w-[58ch] rounded-inset bg-paper px-4 py-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
          </div>
        </div>

        <SkeletonPriorityDial className="hidden lg:flex" />
      </div>

      <div className="relative z-20 flex flex-wrap items-center gap-x-7 gap-y-2 border-t border-rule-soft px-5 py-2.5">
        <Skeleton className="h-5 w-24" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-28 rounded-inset" />
          <Skeleton className="h-7 w-24 rounded-inset" />
        </div>
      </div>
    </div>
  );
}

/**
 * `StatCard` — the old language's metric tile: `rounded-2xl border-black/[0.06]
 * p-5 shadow-sm`, a 20px label, a 36px reading and the stacked-sticks chart
 * beside it, then the gauge and caption.
 *
 * The label is the one the hand-rolled versions kept getting wrong: at
 * `text-[20px]` with normal leading it is 30px tall, not the 12px a `h-3` bar
 * suggests, so the reading sat 18px higher in the placeholder than in the card.
 */
export function SkeletonStatCard({
  labelWidth = "w-32",
  className = "",
}: {
  labelWidth?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm ${className}`}
    >
      <Skeleton className={`h-[30px] ${labelWidth}`} />
      <div className="mt-8 flex items-end justify-between gap-3">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-[58px] w-16 shrink-0 sm:h-[66px]" />
      </div>
      <div className="mt-4">
        <Skeleton className="h-3.5 w-full rounded-sm" />
        <Skeleton className="mt-2 h-[17px] w-32 max-w-full" />
      </div>
    </div>
  );
}

export default Skeleton;
