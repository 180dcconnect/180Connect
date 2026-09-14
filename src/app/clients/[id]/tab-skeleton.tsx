import {
  Skeleton,
  SkeletonFactRows,
  SkeletonSectionCard,
  SkeletonStatGrid,
} from "@/components/ui/skeleton";

/**
 * F234 — the placeholder each tab shows while its own queries run.
 *
 * It covers the tab *body* only. The record's ground, charcoal header and tab bar
 * come from `layout.tsx`, which is above every tab's Suspense boundary and so is
 * already on screen — the shell no longer flashes and rebuilds on a tab change,
 * which is the main thing the route split bought.
 *
 * Rebuilt because the old version drew each card as one `bg-black/10` slab
 * (`h-44 rounded-panel`), and that is the one thing a loading frame must not do:
 * the page draws *white* cards with a visible hairline and a title, 30-odd grey
 * blocks are a different picture entirely, and the swap reads as a flash however
 * well the column widths line up. Every card here is now the real `SectionCard`
 * — same `rounded-panel border-rule`, same `px-5 py-4.5`, same title and hint
 * line boxes — with bars where the words go.
 *
 * The body differs per tab, so each card declares what it holds rather than being
 * given a height: `facts` is the label-over-value rows Basic information and
 * Contactability use, `lines` is prose, `stats` is a row of big readings, and so
 * on. Heights then fall out of the same components the pages use, and a card that
 * changes shape changes here once.
 *
 * Approximated because it is data: how many rows a list or table ends up with
 * (each is drawn at its usual count), and whether a conditional card renders at
 * all — the pending-suggestions section, the converted-only similarity card, the
 * danger-tone card on Outreach.
 */

/** What a card's body holds. `title`/`hint` are widths; `undefined` draws none. */
export type TabSkeletonCard = {
  /** Width class for the section title bar. */
  title: string;
  /** Width class for the one-line hint, where the card has one. */
  hint?: string;
  /** A pill pinned to the heading row's right edge. */
  action?: boolean;
  /** Room for the serif numeral, as on Financials. */
  numbered?: boolean;
} & (
  | { kind: "facts"; rows?: number }
  | { kind: "lines"; lines?: number }
  | { kind: "stats"; cells?: number }
  | { kind: "chips" }
  | { kind: "list"; rows?: number }
  | { kind: "table"; rows?: number; columns?: number }
);

function Body({ card }: { card: TabSkeletonCard }) {
  switch (card.kind) {
    case "facts":
      return <SkeletonFactRows rows={card.rows ?? 3} />;

    case "lines":
      return (
        <div className="mt-3.5 space-y-2">
          {Array.from({ length: card.lines ?? 3 }).map((_, index, all) => (
            <Skeleton
              key={index}
              className={`h-[22px] ${index === all.length - 1 ? "w-2/3" : "w-full"} max-w-full`}
            />
          ))}
        </div>
      );

    case "stats":
      return (
        <>
          <SkeletonStatGrid cells={card.cells ?? 2} />
          <Skeleton className="mt-5 h-3 w-full rounded-sm" />
        </>
      );

    case "chips":
      return (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {["w-20", "w-28", "w-16", "w-24"].map((width, index) => (
            <Skeleton key={index} className={`h-7 rounded-full ${width}`} />
          ))}
        </div>
      );

    case "list":
      return (
        <ul className="mt-3.5 divide-y divide-rule-soft border-t border-rule-soft">
          {Array.from({ length: card.rows ?? 4 }).map((_, index) => (
            <li key={index} className="flex items-start gap-3 py-3">
              <Skeleton className="mt-0.5 h-4 w-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-5 w-2/3 max-w-full" />
                <Skeleton className="mt-1 h-4 w-32" />
              </div>
              <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            </li>
          ))}
        </ul>
      );

    case "table":
      return (
        <div className="mt-3.5">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(2,minmax(3rem,6rem))] gap-4 border-b border-rule pb-2">
            {Array.from({ length: (card.columns ?? 3) - 1 }).map((_, index) => (
              <Skeleton key={index} className="h-3 w-14 justify-self-end" />
            ))}
          </div>
          {Array.from({ length: card.rows ?? 5 }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="grid grid-cols-[minmax(0,1fr)_repeat(2,minmax(3rem,6rem))] items-baseline gap-4 border-b border-rule-soft py-2.5 last:border-b-0"
            >
              <Skeleton className="h-[18px] w-40 max-w-full" />
              <Skeleton className="h-[18px] w-16 justify-self-end" />
              <Skeleton className="h-[18px] w-16 justify-self-end" />
            </div>
          ))}
        </div>
      );
  }
}

export function TabSkeleton({
  cards,
  columns = "split",
  splitAt,
}: {
  /** The tab's cards, in order. */
  cards: TabSkeletonCard[];
  /** `split` matches the 1.55fr/1fr grid; `single` matches a full-width stack. */
  columns?: "split" | "single";
  /** How many cards the wide column holds. Defaults to an even split. */
  splitAt?: number;
}) {
  const rendered = (card: TabSkeletonCard, index: number) => (
    <SkeletonSectionCard
      key={index}
      titleWidth={card.title}
      hintWidth={card.hint}
      action={card.action}
      numbered={card.numbered}
    >
      <Body card={card} />
    </SkeletonSectionCard>
  );

  if (columns === "single") {
    return <div className="space-y-6">{cards.map(rendered)}</div>;
  }

  /**
   * Which cards sit in which column is the tab's own business — the page passes
   * them in order and says where the wide column ends, because several tabs put
   * one card beside two rather than splitting evenly.
   */
  const split = splitAt ?? Math.ceil(cards.length / 2);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className="space-y-6">{cards.slice(0, split).map(rendered)}</div>
      <div className="space-y-6">{cards.slice(split).map(rendered)}</div>
    </div>
  );
}
