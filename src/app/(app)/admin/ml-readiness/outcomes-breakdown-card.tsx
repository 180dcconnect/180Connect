"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { SectionCard } from "@/app/(app)/clients/[id]/section-card";
import {
  PageSizeSelect,
  PagingSummary,
  useListPager,
} from "@/components/ui/list-pager";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { OutcomeGroup, OutcomeGrouping } from "@/lib/ml-readiness";

/**
 * The one breakdown card on the Machine Learning tab: how the recorded outcomes
 * split, by whichever dimension the reader picks.
 *
 * One card with four readings rather than four cards, because the four questions
 * are the same question — "what are we actually learning from?" — and a page that
 * answers it four times over pushes the count it is all in service of off the
 * screen.
 *
 * THE HEADING IS THE CONTROL. The sentence reads "Outcomes by **type**", and the
 * dimension word is the dropdown: dimmed against the ink of "Outcomes by", dotted
 * underline, chevron. A row of chips in the corner made the reader join a word in
 * the heading to a control somewhere else on the card; putting the word in the
 * heading removes the join, and the `h2` still announces "Outcomes by sector" to
 * a screen reader because a heading may hold a button.
 *
 * PAGED, NOT CAPPED. The list used to stop at twelve buckets with "+N more not
 * shown", which hid a client's own outcome count on a busy client just because it
 * sorted past the twelfth. It now pages like every other list in admin — 5/10/15/20
 * per page and "Showing 1 to 4 of 4", both on the heading row — and there is no
 * cap: a client is never invisible, only on a later page. The whole card is paged
 * in the browser from the one read the count above it uses, so switching dimension,
 * page or page size costs no query.
 */

/**
 * The same words for all four dimensions: nothing is recorded yet, and the
 * reason is the same whichever way you ask. Says what will fill it in, because
 * an empty breakdown is a prompt to go and do that, not a dead end.
 */
const EMPTY_COPY =
  "No client outcomes recorded yet. As Client Acquisition Managers (CAMs) record outreach replies and conversions with clients, the breakdown appears here.";

/**
 * What each dimension is called, and what it is showing when it is selected.
 *
 * `control` is written the way it reads in the heading sentence ("Outcomes by
 * sector"); the menu item capitalises it in CSS, so the word has one source.
 */
const GROUPING_COPY: Record<
  OutcomeGrouping,
  { control: string; hint: string; empty: string }
> = {
  type: {
    control: "type",
    hint: "How recorded client responses and results break down in our database.",
    empty: EMPTY_COPY,
  },
  client: {
    control: "client",
    hint: "Which clients the recorded outcomes are with — where the evidence comes from.",
    empty: EMPTY_COPY,
  },
  sector: {
    control: "sector",
    hint: "Which sectors the clients who responded are in, as their sector stands today.",
    empty: EMPTY_COPY,
  },
  month: {
    control: "month",
    hint: "When the outcomes were recorded, most recent first — how fast the evidence is arriving.",
    empty: EMPTY_COPY,
  },
};

const ORDER: readonly OutcomeGrouping[] = ["type", "client", "sector", "month"];

export function OutcomesBreakdownCard({
  groups,
}: {
  groups: Record<OutcomeGrouping, OutcomeGroup[]>;
}) {
  const [active, setActive] = useState<OutcomeGrouping>("type");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const copy = GROUPING_COPY[active];
  const pager = useListPager(groups[active]);

  /**
   * Switching dimension starts at the top of the new list. Page 2 of the month
   * breakdown is not a page of the sector one, and the reader did not ask to keep
   * the number — they asked to see a different question answered.
   */
  function selectGrouping(grouping: OutcomeGrouping) {
    setActive(grouping);
    setIsMenuOpen(false);
    pager.setPage(1);
  }

  return (
    <SectionCard
      headingId="readiness-by-outcome"
      title={
        <>
          Outcomes by{" "}
          <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-dim underline decoration-rule decoration-dotted underline-offset-4 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
              >
                {copy.control}
                <ChevronDown
                  aria-hidden="true"
                  className={`size-3.5 shrink-0 transition-transform duration-200 ${
                    isMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="animate-popover-in w-52 p-1"
            >
              <ul className="flex flex-col">
                {ORDER.map((grouping) => {
                  const isSelected = grouping === active;
                  return (
                    <li key={grouping}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => selectGrouping(grouping)}
                        className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-inset px-2.5 py-1.5 text-left text-[13px] leading-[1.5] capitalize transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none ${
                          isSelected ? "font-semibold text-ink" : "text-dim"
                        }`}
                      >
                        {GROUPING_COPY[grouping].control}
                        {isSelected && (
                          <Check aria-hidden="true" className="size-3.5 shrink-0 text-lead" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </PopoverContent>
          </Popover>
        </>
      }
      hint={copy.hint}
      /*
       * The whole pager lives on the heading row, beside the dimension it is
       * paging: how many per page on the left of the pair, and where in the list
       * you are on its right. Both parts are always drawn when there is anything
       * to count — four sectors is still "Showing 1 to 4 of 4", and a reader who
       * wants five or twenty per page should not have to guess that the control
       * appears only once the list is long enough for it to change something.
       */
      action={
        pager.totalItems > 0 ? (
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <PageSizeSelect pageSize={pager.pageSize} onChange={pager.setPageSize} />
            <PagingSummary summary={pager} onPageChange={pager.setPage} />
          </div>
        ) : undefined
      }
    >
      {pager.totalItems === 0 ? (
        <p className="mt-4 text-sm leading-[1.65] text-dim">{copy.empty}</p>
      ) : (
        <ul
          data-testid="outcome-breakdown"
          className="mt-4 divide-y divide-rule-soft border-t border-rule-soft text-sm"
        >
          {pager.items.map((group) => (
            <li key={group.label} className="flex justify-between gap-4 py-2 tabular-nums">
              <span className="min-w-0 break-words text-dim">{group.label}</span>
              <span className="shrink-0 font-semibold text-ink">{group.count}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
