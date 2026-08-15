"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, SlidersHorizontal, X, ChevronLeft } from "lucide-react";

import { EASE, entranceSoft, stagger } from "@/components/brand/motion";
import { GLASS, LIP } from "@/components/brand/tokens";

/**
 * A glass pill that unfolds into a results panel. Collapsed it is one row —
 * prompt, cycling subject, trailing disc; open it keeps that row exactly where
 * it was and grows a panel underneath, so opening reads as the pill *extending*
 * rather than as a pill leaving and a card arriving. Same reasoning as the menu
 * sheet's twin chrome: nothing that was on screen may appear to move.
 *
 * The whole thing is one `overflow-hidden` box whose height animates. The panel
 * inside is laid out at full size from the first frame and simply clipped, so
 * its content never reflows mid-animation — a panel that animated its own height
 * re-wraps the link list on every frame and shimmers.
 */

/** Cycles behind the prompt while the field is empty and unfocused. */
const SUBJECTS = ["Charities", "Companies", "Grants", "Clients"] as const;

const SUBJECT_HOLD = 2400;

/** Collapsed row height; also the pill's radius, so `rounded-full` and the open
 *  card's corner are the same number and the morph has nothing to interpolate. */
const ROW = 64;

export function BrandSearchBar({
  className = "",
  placeholder = "I want to learn about",
}: {
  className?: string;
  /** The static half of the prompt. The cycling subject follows it. */
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState(0);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const typing = query.length > 0;

  // The subject only cycles while there is nothing else in the row to read.
  useEffect(() => {
    if (open || typing) return;
    const id = setInterval(
      () => setSubject((i) => (i + 1) % SUBJECTS.length),
      SUBJECT_HOLD,
    );
    return () => clearInterval(id);
  }, [open, typing]);

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

  const FILTER_CATEGORIES: Record<string, string[]> = {
    "Filter by city": ["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow"],
    "Filter by outreach status": ["Contacted", "Meeting set", "Proposal sent", "Closed won", "Closed lost"],
    "Filter by owner": ["Bashir Bobboi", "Alice Smith", "Bob Jones", "Charlie Brown"]
  };

  const close = () => {
    setOpen(false);
    setQuery("");
    setTimeout(() => {
      setActiveFilter(null);
      setFilterQuery("");
    }, 300);
  };

  const activeOptions = activeFilter
    ? FILTER_CATEGORIES[activeFilter]?.filter((option) =>
        option.toLowerCase().includes(filterQuery.trim().toLowerCase())
      ) || []
    : [];

  return (
    <div className={`flex w-full max-w-[600px] flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 px-2 empty:hidden">
        <AnimatePresence>
          {selectedFilters.map((filter) => (
            <motion.span
              key={filter}
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 10 }}
              layout
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#f4f4ef] text-[#1a1a1a] px-3 py-1.5 text-[14px] font-medium shadow-sm"
            >
              {filter}
              <button
                type="button"
                onClick={() => setSelectedFilters((prev) => prev.filter((f) => f !== filter))}
                className="hover:bg-black/10 focus:outline-none flex h-4 w-4 items-center justify-center rounded-full bg-black/5 transition-colors text-black/60"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      <motion.div
        ref={rootRef}
        // A plain div, not a combobox: the panel holds links, not options, so the
        // listbox pattern would promise arrow-key selection that isn't there.
        className="relative w-full overflow-hidden backdrop-blur-md"
        style={{ background: GLASS, boxShadow: LIP, borderRadius: ROW / 2 }}
      animate={{ height: open ? "auto" : ROW }}
      initial={false}
      transition={{ duration: 0.55, ease: EASE }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        close();
        inputRef.current?.blur();
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] ring-1 ring-white/25 ring-inset"
        aria-hidden="true"
      />

      <motion.div
        className="pointer-events-none absolute inset-0 z-0 bg-white/25"
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
                  {SUBJECTS.reduce((a, b) => (b.length > a.length ? b : a))}
                </span>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={SUBJECTS[subject]}
                    className="absolute inset-0 text-[#f4f4ef]"
                    initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                    transition={{ duration: 0.45, ease: EASE }}
                  >
                    {SUBJECTS[subject]}
                  </motion.span>
                </AnimatePresence>
              </span>
            </div>
          )}
        </div>

        <AnimatePresence>
          {(typing || selectedFilters.length > 0) && (
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
                onClick={() => {
                  close();
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
            transition={{ duration: 0.3, ease: EASE, delay: 0.12 }}
            className="relative z-10"
          >
            <AnimatePresence mode="wait">
              {activeFilter === null ? (
                <motion.ul
                  key="categories"
                  className="flex flex-col px-4 py-4"
                  variants={stagger(0.05, 0.14)}
                  initial="hidden"
                  animate="show"
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  {Object.keys(FILTER_CATEGORIES).map((filter) => (
                    <motion.li key={filter} variants={entranceSoft}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFilter(filter);
                          setFilterQuery("");
                        }}
                        className="font-body block w-full text-left rounded-2xl px-3 py-2 text-lg font-medium text-[#f4f4ef]/70 transition-colors hover:bg-white/8 hover:text-[#f4f4ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
                      >
                        {filter}
                      </button>
                    </motion.li>
                  ))}
                </motion.ul>
              ) : (
                <motion.ul
                  key="options"
                  className="flex flex-col px-4 py-4"
                  variants={stagger(0.05, 0.14)}
                  initial="hidden"
                  animate="show"
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  <motion.li variants={entranceSoft} className="mb-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFilter(null);
                        setFilterQuery("");
                      }}
                      className="font-body flex items-center gap-2 w-full text-left rounded-2xl px-3 py-2 text-[15px] font-medium text-[#f4f4ef]/50 transition-colors hover:bg-white/8 hover:text-[#f4f4ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back to filters
                    </button>
                  </motion.li>

                  <motion.li variants={entranceSoft} className="mb-4 px-3">
                    <input
                      type="search"
                      placeholder={`Search ${activeFilter?.replace("Filter by ", "").toLowerCase()}...`}
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      className="font-body w-full bg-white/10 text-[15px] text-[#f4f4ef] placeholder:text-[#f4f4ef]/40 rounded-xl px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-[#e6f5c0] [&::-webkit-search-cancel-button]:hidden"
                    />
                  </motion.li>

                  {activeOptions.map((option) => (
                    <motion.li key={option} variants={entranceSoft}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedFilters.includes(option)) {
                            setSelectedFilters((prev) => [...prev, option]);
                          }
                          close();
                        }}
                        className="font-body block w-full text-left rounded-2xl px-3 py-2 text-lg font-medium text-[#f4f4ef]/70 transition-colors hover:bg-white/8 hover:text-[#f4f4ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
                      >
                        {option}
                      </button>
                    </motion.li>
                  ))}

                  {activeOptions.length === 0 && (
                    <motion.li variants={entranceSoft} className="font-body px-3 py-2 text-[15px] text-[#f4f4ef]/40">
                      No matches found.
                    </motion.li>
                  )}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      </motion.div>
    </div>
  );
}


