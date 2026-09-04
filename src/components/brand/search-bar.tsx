"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { ArrowRight, Check, ChevronLeft, Plus, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { EASE, stagger } from "@/components/brand/motion";
import { LIP, SEARCH_GLASS, SEARCH_GLASS_FROSTED, SEARCH_GLASS_OPEN } from "@/components/brand/tokens";
import { tagPillStyle } from "@/lib/tags/tag-colours";

/** Cycles behind the prompt while the field is empty and unfocused. */
const DEFAULT_SUBJECTS = ["Charities", "Companies", "Grants", "Clients"] as const;

const SUBJECT_HOLD = 2400;

/** Collapsed row height; also the pill's radius, so `rounded-full` and the open
 *  card's corner are the same number and the morph has nothing to interpolate. */
const ROW = 64;

const PANEL_STAGGER = stagger(0.05, 0.14);

const OPTION_LIST: Variants = { hidden: {}, show: {} };

/**
 * Motion inside the glass must never touch `filter` — not even `blur(0px)`.
 * Any non-none filter on a descendant of a `backdrop-filter` element poisons
 * the parent's backdrop sampling in Chrome and Safari (the child-filter
 * compositing bug): the frost reads for a second and then goes flat forever,
 * exactly what the lingering `blur(0px)` from the old blur-up rows did. So
 * everything in here rises on opacity and y only. The house blur-up entrance
 * stays everywhere outside the glass.
 */
const GLASS_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

const glassItemIndexed = (step = 0.025, cap = 0.3): Variants => ({
  hidden: { opacity: 0, y: 8 },
  show: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: EASE, delay: Math.min(index * step, cap) },
  }),
});

const GLASS_OPTIONS = glassItemIndexed(0.025, 0.3);

function rankOption(label: string, query: string): number {
  const l = label.toLowerCase();
  if (l.startsWith(query)) return 0;
  if (l.includes(` ${query}`)) return 1;
  return l.includes(query) ? 2 : -1;
}

/**
 * F194 — `colour` is optional so only tag options carry it. In the dark glass
 * panel a colour renders as a swatch dot (the palette's text hues are tuned
 * for light surfaces, so tinting text here would be unreadable); on the light
 * chip row below the bar the full pill tint is used instead.
 */
export type FilterOption = { label: string; value: string; colour?: string };

/**
 * A single row in the open panel, for placements that offer actions rather
 * than filters. Tapping a row with `expandedContent` swaps the button for
 * that content in place (a transform, not an accordion) — the content should
 * provide its own dismiss via the `collapse` control it receives, since no
 * external close button is rendered beside it.
 */
export type PanelRow = {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  expandedContent?:
    | React.ReactNode
    | ((controls: { collapse: () => void }) => React.ReactNode);
  /**
   * Render the content directly with no button state — for fields that wear
   * their own button face (the gooey capsule's resting label) and need no
   * transform to become one.
   */
  alwaysExpanded?: boolean;
  onSelect?: () => void;
};

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
   frosted = false,
   promptButton = false,
   panelRows,
   compactRest = false,
   onSubmit,
   submitLabel = "Submit",
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
   defaultFilters?: (FilterOption & { category: string })[];
   /**
    * Stronger frost on the glass (20px backdrop blur under a 0.5 tint instead
    * of 3px under 0.72), so the page behind an open panel reads as blurred
    * texture. Opt-in per instance — the clients-list bar keeps its look.
    */
   frosted?: boolean;
   /**
    * Render the prompt row as a button that opens the panel instead of a
    * text input — for placements where the bar triggers options rather than
    * taking a query. The cycling subjects stay exactly as they are.
    */
   promptButton?: boolean;
   /**
    * Replace the filter categories (and their drill-down) with plain rows.
    * For placements like the booklet composer, whose panel offers actions
    * rather than filters.
    */
   panelRows?: PanelRow[];
   /**
    * Rest compact: the closed pill shrinks to its content instead of spanning
    * full width, then widens back on open before the panel unfolds — the
    * widen-then-drop two-beat. The widest cycling subject reserves the rest
    * width, so word swaps never resize the pill. Opt-in per instance.
    */
   compactRest?: boolean;
   /**
    * Primary go action for the panel, rendered as the lime arrow disc beside
    * the open/close toggle — the search bar's own submit button, copied. Only
    * rendered when provided.
    */
   onSubmit?: () => void;
   /** Accessible label for the submit disc. */
   submitLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultQuery);
  const [subject, setSubject] = useState(0);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState<(FilterOption & { category: string })[]>(defaultFilters);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [isSearching, setIsSearching] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  /**
   * `compactRest` morphs between two boxes whose sizes are known, so both ends
   * of the widen are measured pixels. Keyword ends (`fit-content` → `100%`)
   * cannot be tweened directly: Motion resolves them on the frame the
   * animation starts, which is the frame the panel mounts — and the panel's
   * own content is what `fit-content` then measures. The widen therefore began
   * at almost its end value and read as a snap, with the delayed height drop
   * arriving as a second one. Two numbers make it one continuous tween.
   */
  const [restWidth, setRestWidth] = useState<number | null>(null);
  const [fullWidth, setFullWidth] = useState<number | null>(null);

  // The frame keeps its full width whether or not the bar is open, so it is
  // the one thing that can be observed for the open end (and for a resize).
  useEffect(() => {
    const frame = frameRef.current;
    if (!compactRest || !frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setFullWidth(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [compactRest]);

  // The resting end has to be read while the bar is closed AND unlocked —
  // hence the null pass before each read, which lets `fit-content` resolve
  // fresh. Re-read once fonts settle: the resting pill is sized by its own
  // label, so a swapped face changes it.
  useEffect(() => {
    if (!compactRest) return;
    let raf = 0;
    const measure = () => {
      setRestWidth(null);
      raf = requestAnimationFrame(() => {
        if (rootRef.current) setRestWidth(rootRef.current.offsetWidth);
      });
    };
    measure();
    let cancelled = false;
    document.fonts?.ready.then(() => {
      // Closed is read off the box itself rather than off `open`: this fires on
      // the font loader's schedule, and re-measuring an open bar would unlock
      // its width mid-panel.
      if (cancelled || rootRef.current?.offsetHeight !== ROW) return;
      measure();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [compactRest]);

  const typing = query.length > 0;

  // The subject only cycles while there is nothing else in the row to read —
  // except in prompt-button mode, where the cycling words ARE the button's
  // label and must keep turning even with the panel open.
  useEffect(() => {
    if (typing) return;
    if (open && !promptButton) return;
    const id = setInterval(
      () => setSubject((i) => (i + 1) % subjects.length),
      SUBJECT_HOLD,
    );
    return () => clearInterval(id);
  }, [open, typing, promptButton, subjects.length]);

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

  // Memoised so the options memo below doesn't re-run on every render — a
  // fresh object literal here would defeat it.
  const FILTER_CATEGORIES: Record<string, FilterOption[]> = useMemo(() => categories || DEFAULT_CATEGORIES, [categories]);
  const FILTER_PARAMS: Record<string, string> = useMemo(() => paramNames || DEFAULT_PARAMS, [paramNames]);

  const submitSearch = (filters = selectedFilters, q = query, closePanel = true) => {
    if (isSearching) return;
    setIsSearching(true);

    if (closePanel) {
      setOpen(false);
    }

    const params = new URLSearchParams(window.location.search);
    params.delete("q");
    params.delete("page");
    Object.values(FILTER_PARAMS).forEach((name) => params.delete(name));

    if (q) params.set("q", q);

    // `append`, not `set`: the panel already lets several options be chosen in
    // one category, but `set` overwrote each with the next, so only the last
    // survived the trip through the URL and multi-select silently behaved like
    // single-select. Repeating the parameter is what the host page reads back
    // as an array.
    filters.forEach((f) => {
      params.append(FILTER_PARAMS[f.category] ?? "filter", f.value);
    });

    // Plays the rolling square animation before navigating (dev's designed
    // submit moment). Still a soft navigation — router.replace, no document
    // reload — so F052's AC4 holds; the spinner doubles as the double-submit
    // guard via `isSearching`.
    setTimeout(() => {
      startTransition(() => {
        router.replace(`?${params.toString()}`, { scroll: false });
      });
      setTimeout(() => {
        setIsSearching(false);
      }, 400);
    }, 1500);

    if (closePanel) {
      setOpen(false);
    }
  };

  const close = () => {
    setOpen(false);
    setTimeout(() => {
      setActiveFilter(null);
      setFilterQuery("");
      setExpandedRow(null);
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
      <div ref={frameRef} className="relative h-[64px] w-full z-50">
        <motion.div
          ref={rootRef}
          className={`absolute top-0 left-1/2 w-full overflow-hidden ${frosted ? "backdrop-blur-[20px]" : "backdrop-blur-[3px]"}`}
          style={{ boxShadow: LIP, borderRadius: ROW / 2, x: "-50%" }}
          animate={{
            height: open ? "auto" : ROW,
            // Pixels at both ends once measured (see restWidth/fullWidth), so
            // the widen is a pure number tween with nothing to resolve on the
            // frame it starts. The keyword pair is only the pre-measure
            // fallback for the first frame.
            width: compactRest
              ? open
                ? (fullWidth ?? "100%")
                : (restWidth ?? "fit-content")
              : "100%",
            backgroundColor: open
              ? frosted
                ? SEARCH_GLASS_FROSTED
                : SEARCH_GLASS_OPEN
              : SEARCH_GLASS,
          }}
          initial={false}
          transition={
            compactRest
              ? {
                  // Opening is two beats in order: the pill widens, and only
                  // once it has settled does the panel drop out of it. The
                  // delay is the width's own duration, so neither beat is
                  // running while the other is. Closing keeps both together —
                  // a collapse reads better as one movement.
                  width: { duration: 0.42, ease: EASE },
                  height: {
                    duration: 0.42,
                    ease: EASE,
                    delay: open ? 0.42 : 0,
                  },
                  backgroundColor: { duration: 0.7, ease: EASE },
                }
              : { duration: 0.7, ease: EASE }
          }
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
          {/* The frost lives on its own childless layer, never on the container
              that holds the panel. `backdrop-filter` is defeated by any `filter`
              anywhere in its own subtree — a promoted `will-change: filter` layer
              is enough — and the panel's content is full of them (liquid-gooey
              paints its capsule through an SVG drop-shadow filter, and Motion's
              blur-up variants settle at a lingering `blur(0px)`). Sharing one
              element made the frost read for a second or two and then go flat for
              the rest of the session, once the compositor promoted whichever
              filtered descendant painted last. A leaf can never be poisoned: it
              has no descendants. It samples the page *and* the container's own
              tint painted beneath it, which is flat, so the look is unchanged. */}
          <div
            className={`pointer-events-none absolute inset-0 z-0 rounded-[inherit] ${frosted ? "backdrop-blur-[20px]" : "backdrop-blur-[3px]"}`}
            aria-hidden="true"
          />

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
        {promptButton ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label="Open options"
            className="relative mr-3 min-w-0 flex-1 cursor-pointer text-left"
          >
            <span
              className="font-body flex items-center gap-[0.4ch] text-[15px] whitespace-nowrap sm:text-base"
              aria-hidden="true"
            >
              <span className="text-[#f4f4ef]/55">{placeholder}</span>
              <span className="relative">
                <span className="invisible">
                  {subjects.reduce((a, b) => (b.length > a.length ? b : a), "")}
                </span>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={subjects[subject]}
                    className="absolute inset-0 text-[#f4f4ef]"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.45, ease: EASE }}
                  >
                    {subjects[subject]}
                  </motion.span>
                </AnimatePresence>
              </span>
            </span>
          </button>
        ) : (
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
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.45, ease: EASE }}
                  >
                    {subjects[subject]}
                  </motion.span>
                </AnimatePresence>
              </span>
            </div>
          )}
        </div>
        )}

        <AnimatePresence>
          {(typing || selectedFilters.length > 0 || isSearching) && (
            <motion.div
              initial={{ width: 0, opacity: 0, scale: 0.8 }}
              animate={{ width: 30, opacity: 1, scale: 1 }}
              exit={{ width: 0, opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="shrink-0 overflow-visible"
            >
              <button
                type="button"
                aria-label={isSearching ? "Searching…" : "Search"}
                title={isSearching ? "Searching…" : "Press Enter or click to search"}
                disabled={isSearching}
                onClick={() => {
                  submitSearch();
                  inputRef.current?.blur();
                }}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0] ${
                  isSearching
                    ? "bg-transparent"
                    : "bg-[#e6f5c0] text-[#1a1a1a] hover:bg-[#d4e5a0]"
                }`}
              >
                {isSearching ? (
                  <div
                    className="h-4.5 w-4.5 rounded-[4px] bg-[#e6f5c0] animate-spin shadow-[0_0_10px_rgba(230,245,192,0.65)]"
                    style={{ animationDuration: "2.5s" }}
                  />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="ml-3 flex shrink-0 items-center gap-2">
          {onSubmit && (
            <button
              type="button"
              aria-label={submitLabel}
              title={submitLabel}
              onClick={onSubmit}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e6f5c0] text-[#1a1a1a] transition-all hover:bg-[#d4e5a0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
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
            transition={{ duration: 0.5, ease: EASE, delay: compactRest ? 0.56 : 0.2 }}
            className="relative z-10"
            // Held at the open width for the whole morph. Left to `w-full` it
            // re-laid-out on every frame of the widen — rows squeezing and
            // reflowing inside the clip — which is the other half of what read
            // as a snap.
            style={compactRest && fullWidth ? { width: fullWidth } : undefined}
          >
            <AnimatePresence mode="wait">
              {panelRows ? (
                <motion.ul
                  key="rows"
                  className="flex flex-col gap-1 px-4 py-4 h-[280px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  variants={PANEL_STAGGER}
                  initial="hidden"
                  animate="show"
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  {panelRows.map((row) => {
                    if (row.alwaysExpanded) {
                      return (
                        <motion.li key={row.label} variants={GLASS_ITEM}>
                          {row.hint && (
                            <p className="px-3 pt-1 text-[13px] text-[#f4f4ef]/60">
                              {row.hint}
                            </p>
                          )}
                          {typeof row.expandedContent === "function"
                            ? row.expandedContent({
                                collapse: () => setExpandedRow(null),
                              })
                            : row.expandedContent}
                        </motion.li>
                      );
                    }
                    const transformable = row.expandedContent !== undefined;
                    const transformed = expandedRow === row.label;
                    const interactive = transformable || row.onSelect !== undefined;
                    return (
                      <motion.li key={row.label} variants={GLASS_ITEM}>
                        <AnimatePresence mode="wait" initial={false}>
                          {transformable && transformed ? (
                            <motion.div
                              key={`${row.label}-field`}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.2, ease: EASE }}
                              className="px-3 py-2"
                            >
                              {typeof row.expandedContent === "function"
                                ? row.expandedContent({
                                    collapse: () => setExpandedRow(null),
                                  })
                                : row.expandedContent}
                            </motion.div>
                          ) : interactive ? (
                            <motion.button
                              key={`${row.label}-button`}
                              type="button"
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.15, ease: EASE }}
                              onClick={() => {
                                if (transformable) {
                                  setExpandedRow(row.label);
                                }
                                row.onSelect?.();
                              }}
                              className="font-body flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
                            >
                              {row.icon}
                              <span className="min-w-0 flex-1">
                                <span className="block text-lg font-medium text-white">
                                  {row.label}
                                </span>
                                {row.hint && (
                                  <span className="mt-0.5 block text-[13px] text-[#f4f4ef]/60">
                                    {row.hint}
                                  </span>
                                )}
                              </span>
                              {transformable && (
                                <Plus
                                  aria-hidden="true"
                                  className="h-4 w-4 shrink-0 text-[#f4f4ef]/70"
                                />
                              )}
                            </motion.button>
                          ) : (
                            <div className="font-body flex w-full items-center gap-3 rounded-2xl px-3 py-2">
                              {row.icon}
                              <span className="min-w-0 flex-1">
                                <span className="block text-lg font-medium text-white">
                                  {row.label}
                                </span>
                                {row.hint && (
                                  <span className="mt-0.5 block text-[13px] text-[#f4f4ef]/60">
                                    {row.hint}
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                        </AnimatePresence>
                      </motion.li>
                    );
                  })}
                </motion.ul>
              ) : activeFilter === null ? (
                  <motion.ul
                    key="categories"
                    className="flex flex-col gap-1 px-4 py-4 h-[280px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  variants={PANEL_STAGGER}
                  initial="hidden"
                  animate="show"
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  {Object.keys(FILTER_CATEGORIES).map((filter) => {
                    const count = selectedFilters.filter((f) => f.category === filter).length;
                    return (
                      <motion.li key={filter} variants={GLASS_ITEM}>
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
                  <motion.div variants={GLASS_ITEM} className="mb-4 px-4 flex items-center gap-2 shrink-0">
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
                    className="flex-1 flex flex-col gap-1 px-4 pb-4 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  >
                    {activeOptions.map((option, index) => {
                      const isSelected = selectedFilters.some(
                        (f) => f.category === activeFilter && f.value === option.value
                      );
                      return (
                        <motion.li key={option.value} variants={GLASS_OPTIONS} custom={index}>
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
                                    colour: option.colour,
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
                            <span className="flex items-center gap-2">
                              {option.colour && (
                                <span
                                  aria-hidden="true"
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: option.colour }}
                                />
                              )}
                              {option.label}
                            </span>
                            {isSelected && (
                              <Check className="h-4 w-4 text-[#e6f5c0]" />
                            )}
                          </button>
                        </motion.li>
                      );
                    })}

                    {/* Explicit `initial`/`animate` rather than a variant. An
                        empty result is the one row that must never wait on the
                        panel's orchestration — inheriting the staggered variant
                        left it held at `hidden`, so a search that matched
                        nothing looked identical to a search that hadn't run yet. */}
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
        {selectedFilters.map((filter) => {
          // F194 AC2 — a coloured tag's chip wears the same pill tint the tag
          // chips use everywhere else; uncoloured filters keep the bone chip.
          const pill = tagPillStyle(filter.colour);
          return (
            <motion.span
              key={`${filter.category}-${filter.value}`}
              initial={{ opacity: 0, scale: 0.8, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -10 }}
              layout
              style={pill ?? undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium shadow-sm ${
                pill ? "" : "bg-[#f4f4ef] text-[#1a1a1a]"
              }`}
            >
              {pill && (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: filter.colour }}
                />
              )}
              {filter.label}
              <button
                type="button"
                onClick={() => {
                  setSelectedFilters((prev) =>
                    prev.filter((f) => f.value !== filter.value || f.category !== filter.category)
                  );
                }}
                className={`hover:bg-black/10 focus:outline-none flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
                  pill ? "bg-black/5 text-black/50" : "bg-black/5 text-black/60"
                }`}
              >
                <X className="h-3 w-3" />
              </button>
            </motion.span>
          );
        })}
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


