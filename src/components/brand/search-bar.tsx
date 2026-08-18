"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronLeft, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { EASE, entranceIndexed, entranceSoft, stagger } from "@/components/brand/motion";
import { LIP, SEARCH_GLASS, SEARCH_GLASS_OPEN } from "@/components/brand/tokens";

/** Cycles behind the prompt while the field is empty and unfocused. */
const DEFAULT_SUBJECTS = ["Charities", "Companies", "Grants", "Clients"] as const;

const SUBJECT_HOLD = 2400;

/** Collapsed row height; also the pill's radius, so `rounded-full` and the open
 *  card's corner are the same number and the morph has nothing to interpolate. */
const ROW = 64;

const PANEL_STAGGER = stagger(0.05, 0.14);

const OPTION_LIST: Variants = { hidden: {}, show: {} };

const OPTION_ENTRANCE = entranceIndexed(0.025, 0.3);

function rankOption(label: string, query: string): number {
  const l = label.toLowerCase();
  if (l.startsWith(query)) return 0;
  if (l.includes(` ${query}`)) return 1;
  return l.includes(query) ? 2 : -1;
}

export type FilterOption = { label: string; value: string };

/**
 * Demo content, used only when a host page passes no `categories`. The matching
 * `DEFAULT_PARAMS` below keeps the two halves of that fallback in one place —
 * a category with no query parameter silently searches for nothing.
 */
const DEFAULT_CATEGORIES: Record<string, FilterOption[]> = {
  "Filter by city": ["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow"].map((c) => ({ label: c, value: c })),
  "Filter by outreach status": ["Contacted", "Meeting set", "Proposal sent", "Closed won", "Closed lost"].map((c) => ({ label: c, value: c })),
  "Filter by owner": ["Bashir Bobboi", "Alice Smith", "Bob Jones", "Charlie Brown"].map((c) => ({ label: c, value: c })),
  "Filter by source": ["Companies House", "Charity Commission", "360Giving"].map((c) => ({ label: c, value: c })),
};

const DEFAULT_PARAMS: Record<string, string> = {
  "Filter by city": "city",
  "Filter by outreach status": "status",
  "Filter by owner": "owner",
  "Filter by source": "source",
};

export function BrandSearchBar({
  className = "",
  placeholder = "I want to learn about",
  subjects = DEFAULT_SUBJECTS,
  categories,
  params: paramNames,
  defaultQuery = "",
  defaultFilters = [],
}: {
  className?: string;
  placeholder?: string;
  /** Words that cycle behind the prompt. Name what *this* page holds. */
  subjects?: readonly string[];
  categories?: Record<string, FilterOption[]>;
  /**
   * Category label → the query parameter its choice writes. Required alongside
   * `categories`: which URL a filter lands on is the host page's business, not
   * this component's, and hard-coding one page's parameter names here is what
   * stopped a second page from reusing the bar.
   */
  params?: Record<string, string>;
  defaultQuery?: string;
  defaultFilters?: { category: string; label: string; value: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultQuery);
  const [subject, setSubject] = useState(0);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState<{ category: string; label: string; value: string }[]>(defaultFilters);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const typing = query.length > 0;

  // The subject only cycles while there is nothing else in the row to read.
  useEffect(() => {
    if (open || typing) return;
    const id = setInterval(
      () => setSubject((i) => (i + 1) % subjects.length),
      SUBJECT_HOLD,
    );
    return () => clearInterval(id);
  }, [open, typing, subjects.length]);

  // Pointerdown, not click: a click that starts inside and ends outside (a drag
  // over the results) would otherwise close the panel out from under the cursor.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const FILTER_CATEGORIES: Record<string, FilterOption[]> = categories || DEFAULT_CATEGORIES;
  const FILTER_PARAMS: Record<string, string> = paramNames || DEFAULT_PARAMS;

  const submitSearch = (filters = selectedFilters, q = query, closePanel = true) => {
    // Start from the address bar, not from empty: the host page may carry state
    // this bar knows nothing about (the client list's funnel stage and breakdown
    // sort), and rebuilding the query string from scratch silently reset it.
    // Read via `window` rather than `useSearchParams` — the hook would opt every
    // page holding this bar out of static rendering, and this only runs on submit.
    const params = new URLSearchParams(window.location.search);
    params.delete("q");
    params.delete("page");
    Object.values(FILTER_PARAMS).forEach((name) => params.delete(name));

    if (q) params.set("q", q);

    filters.forEach(f => {
      params.set(FILTER_PARAMS[f.category] ?? "filter", f.value);
    });

    router.push(`?${params.toString()}`);
    if (closePanel) {
      setOpen(false);
    }
  };

  const close = () => {
    setOpen(false);
    setTimeout(() => {
      setActiveFilter(null);
      setFilterQuery("");
    }, 300);
  };

  const trimmedFilterQuery = filterQuery.trim();

  const activeOptions = useMemo(() => {
    if (!activeFilter) return [];
    const all = FILTER_CATEGORIES[activeFilter] ?? [];
    const q = trimmedFilterQuery.toLowerCase();
    if (!q) return all;

    // Decorate-sort-undecorate: the source index is the tie-break, so equally
    // ranked options keep the order the host page gave them.
    return all
      .map((option, index) => ({ option, index, rank: rankOption(option.label, q) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.option);
  }, [activeFilter, trimmedFilterQuery, FILTER_CATEGORIES]);

  return (
    <div className={`flex w-full max-w-[600px] flex-col gap-3 ${className}`}>
      <div className="relative h-[64px] w-full z-50">
        <motion.div
          ref={rootRef}
          className="absolute top-0 left-0 w-full overflow-hidden backdrop-blur-[3px]"
          style={{ boxShadow: LIP, borderRadius: ROW / 2 }}
          animate={{
            height: open ? "auto" : ROW,
            backgroundColor: open ? SEARCH_GLASS_OPEN : SEARCH_GLASS,
          }}
          initial={false}
          transition={{ duration: 0.7, ease: EASE }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.stopPropagation();
              close();
              inputRef.current?.blur();
            } else if (e.key === "Enter") {
              e.preventDefault();
              submitSearch();
              inputRef.current?.blur();
            }
          }}
        >
          <div
            className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] ring-1 ring-white/25 ring-inset"
            aria-hidden="true"
          />

      {/* Lifts the open panel off pure ink so it reads as lit glass rather than a
          hole in the page. Small, because the tint underneath is doing the work. */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-0 bg-white/8"
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.3, ease: EASE }}
      />

      <div className="relative z-20 flex items-center pr-3 pl-7 rounded-[32px] bg-black/20" style={{ height: ROW }}>
        <div className="relative min-w-0 flex-1 mr-3">
          <input
            ref={inputRef}
            type="search"
            value={query}
            aria-label={`${placeholder}…`}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitSearch();
                inputRef.current?.blur();
              }
            }}
            className="font-body w-full bg-transparent text-[15px] text-[#f4f4ef] caret-[#e6f5c0] outline-none focus-visible:outline-none sm:text-base [&::-webkit-search-cancel-button]:hidden"
          />

          {/* Sits over the empty field rather than in `placeholder`, which can
              only carry one colour and cannot animate. Click-through so the
              prompt still focuses the input. */}
          {!typing && (
            <div
              className="font-body pointer-events-none absolute inset-0 flex items-center gap-[0.4ch] text-[15px] whitespace-nowrap sm:text-base"
              aria-hidden="true"
            >
              <span className="text-[#f4f4ef]/55">{placeholder}</span>
              <span className="relative">
                {/* Reserves the widest subject's width so the row never jumps
                    as the word swaps under an absolutely-positioned twin. */}
                <span className="invisible">
                  {subjects.reduce((a, b) => (b.length > a.length ? b : a), "")}
                </span>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={subjects[subject]}
                    className="absolute inset-0 text-[#f4f4ef]"
                    initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                    transition={{ duration: 0.45, ease: EASE }}
                  >
                    {subjects[subject]}
                  </motion.span>
                </AnimatePresence>
              </span>
            </div>
          )}
        </div>

        <AnimatePresence>
          {(typing || selectedFilters.length > 0 || open) && (
            <motion.div
              initial={{ width: 0, opacity: 0, scale: 0.8 }}
              animate={{ width: 30, opacity: 1, scale: 1 }}
              exit={{ width: 0, opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="shrink-0 overflow-visible"
            >
              <button
                type="button"
                aria-label="Search"
                title="Press Enter or click to search"
                onClick={() => {
                  submitSearch();
                  inputRef.current?.blur();
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e6f5c0] text-[#1a1a1a] transition-colors hover:bg-[#d4e5a0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="ml-3 shrink-0">
          <button
            type="button"
            aria-label={open ? "Close filters" : "Open filters"}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={() => {
              if (open) {
                close();
                inputRef.current?.blur();
              } else {
                setOpen(true);
              }
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/12 text-[#f4f4ef] transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
          >
            {open ? <X className="h-5 w-5" /> : <SlidersHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={listId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.18, ease: EASE } }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.2 }}
            className="relative z-10"
          >
            <AnimatePresence mode="wait">
              {activeFilter === null ? (
                <motion.ul
                  key="categories"
                  className="flex flex-col px-4 py-4 h-[280px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  variants={PANEL_STAGGER}
                  initial="hidden"
                  animate="show"
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  {Object.keys(FILTER_CATEGORIES).map((filter) => {
                    const count = selectedFilters.filter((f) => f.category === filter).length;
                    return (
                      <motion.li key={filter} variants={entranceSoft}>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveFilter(filter);
                            setFilterQuery("");
                          }}
                          className="font-body flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-lg font-medium text-white transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
                        >
                          <span>{filter}</span>
                          {count > 0 && (
                            <span className="rounded-full bg-[#e6f5c0] px-2 py-0.5 text-xs font-bold text-[#1a1a1a]">
                              {count}
                            </span>
                          )}
                        </button>
                      </motion.li>
                    );
                  })}
                </motion.ul>
              ) : (
                <motion.div
                  key="options"
                  className="flex flex-col h-[280px] pt-4"
                  variants={PANEL_STAGGER}
                  initial="hidden"
                  animate="show"
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  <motion.div variants={entranceSoft} className="mb-4 px-4 flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFilter(null);
                        setFilterQuery("");
                      }}
                      className="font-body flex items-center gap-1 shrink-0 rounded-2xl px-3 py-2 text-[15px] font-medium text-[#f4f4ef]/50 transition-colors hover:bg-white/8 hover:text-[#f4f4ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back
                    </button>

                    <input
                      type="search"
                      placeholder={`Search ${activeFilter?.replace("Filter by ", "").toLowerCase()}...`}
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submitSearch();
                          inputRef.current?.blur();
                        }
                      }}
                      className="font-body flex-1 min-w-0 bg-white/10 text-[15px] text-[#f4f4ef] placeholder:text-[#f4f4ef]/40 rounded-xl px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-[#e6f5c0] [&::-webkit-search-cancel-button]:hidden"
                    />
                  </motion.div>

                  <motion.ul
                    variants={OPTION_LIST}
                    className="flex-1 flex flex-col px-4 pb-4 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  >
                    {activeOptions.map((option, index) => {
                      const isSelected = selectedFilters.some(
                        (f) => f.category === activeFilter && f.value === option.value
                      );
                      return (
                        <motion.li key={option.value} variants={OPTION_ENTRANCE} custom={index}>
                          <button
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                setSelectedFilters((prev) =>
                                  prev.filter(
                                    (f) => !(f.category === activeFilter && f.value === option.value)
                                  )
                                );
                              } else {
                                setSelectedFilters((prev) => [
                                  ...prev,
                                  {
                                    category: activeFilter as string,
                                    label: option.label,
                                    value: option.value,
                                  },
                                ]);
                              }
                            }}
                            className={`font-body flex w-full items-center justify-between rounded-2xl px-3 py-2 text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0] ${
                              isSelected
                                ? "bg-white/15 text-[#e6f5c0]"
                                : "text-white hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            <span>{option.label}</span>
                            {isSelected && (
                              <Check className="h-4 w-4 text-[#e6f5c0]" />
                            )}
                          </button>
                        </motion.li>
                      );
                    })}

                    {/* Explicit `initial`/`animate` rather than a variant. An
                        empty result is the one row that must never wait on the
                        panel's orchestration — inheriting `entranceSoft` left it
                        held at `hidden`, so a search that matched nothing looked
                        identical to a search that hadn't run yet. */}
                    {activeOptions.length === 0 && (
                      <motion.li
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2, ease: EASE }}
                        className="font-body px-3 py-3 text-[15px] text-[#f4f4ef]/60"
                        role="status"
                      >
                        {trimmedFilterQuery
                          ? `No match for “${trimmedFilterQuery}”.`
                          : "Nothing to filter by here."}
                      </motion.li>
                    )}
                  </motion.ul>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      </motion.div>
      </div>

      {/* Under the pill, not above it. The bar is pinned by its host page, and
          a chip row above it would push the pill down by its own height the
          moment a filter is picked — the one element on the page that must not
          move. Hanging underneath, the chips grow into the content instead, and
          the open panel simply covers them. */}
      <div className="flex flex-wrap items-center gap-2 px-2 empty:hidden">
        <AnimatePresence>
          {selectedFilters.map((filter) => (
            <motion.span
              key={`${filter.category}-${filter.value}`}
              initial={{ opacity: 0, scale: 0.8, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -10 }}
              layout
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#f4f4ef] text-[#1a1a1a] px-3 py-1.5 text-[14px] font-medium shadow-sm"
            >
              {filter.label}
              <button
                type="button"
                onClick={() => {
                  setSelectedFilters((prev) =>
                    prev.filter((f) => f.value !== filter.value || f.category !== filter.category)
                  );
                }}
                className="hover:bg-black/10 focus:outline-none flex h-4 w-4 items-center justify-center rounded-full bg-black/5 transition-colors text-black/60"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        {(selectedFilters.length > 0 || query) && (
          <button
            type="button"
            onClick={() => {
              setSelectedFilters([]);
              setQuery("");
              submitSearch([], "");
            }}
            className="text-[13px] font-medium text-black/40 hover:text-black transition-colors ml-1"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}


