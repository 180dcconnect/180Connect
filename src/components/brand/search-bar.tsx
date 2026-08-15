"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { EASE, entranceSoft, stagger } from "@/components/brand/motion";
import { menuLinks } from "@/components/brand/nav";
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

  const results = menuLinks.filter((link) =>
    link.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <motion.div
      ref={rootRef}
      // A plain div, not a combobox: the panel holds links, not options, so the
      // listbox pattern would promise arrow-key selection that isn't there.
      className={`relative w-full max-w-[600px] overflow-hidden backdrop-blur-md ${className}`}
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
      {/* The rim is drawn as its own layer so it tracks the box's radius while
          the height animates, without a `ring` re-rendering on the motion div. */}
      <div
        className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] ring-1 ring-white/25 ring-inset"
        aria-hidden="true"
      />

      <div className="relative flex items-center gap-3 pr-3 pl-7" style={{ height: ROW }}>
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            type="search"
            value={query}
            aria-label={`${placeholder}…`}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
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

        <button
          type="button"
          aria-label={open ? "Close search" : "Open search"}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => {
            if (open) {
              close();
              inputRef.current?.blur();
            } else {
              inputRef.current?.focus();
            }
          }}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/12 text-[#f4f4ef] transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
        >
          <DotsToX open={open} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={listId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.18, ease: EASE } }}
            transition={{ duration: 0.3, ease: EASE, delay: 0.12 }}
          >
            <div className="mx-7 h-px bg-white/12" />

            <motion.ul
              className="flex flex-col px-4 py-4"
              variants={stagger(0.05, 0.14)}
              initial="hidden"
              animate="show"
            >
              {results.map((link) => (
                <motion.li key={link.href} variants={entranceSoft}>
                  <Link
                    href={link.href}
                    onClick={close}
                    className="font-body block rounded-2xl px-3 py-2 text-lg font-medium text-[#f4f4ef]/70 transition-colors hover:bg-white/8 hover:text-[#f4f4ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]"
                  >
                    {link.label}
                  </Link>
                </motion.li>
              ))}

              {results.length === 0 && (
                <motion.li
                  variants={entranceSoft}
                  className="font-body px-3 py-2 text-[15px] text-[#f4f4ef]/40"
                >
                  Nothing matches “{query.trim()}”.
                </motion.li>
              )}
            </motion.ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * The three dots collapse inward one after another and the cross draws itself
 * out of the middle — staged, not a crossfade, so the glyph reads as the same
 * object changing state. Dots leave outside-in; the bars arrive as the last one
 * lands.
 */
function DotsToX({ open }: { open: boolean }) {
  return (
    <span className="relative block h-4 w-4">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute top-1/2 h-[3px] w-[3px] rounded-full bg-current"
          style={{ left: 1.5 + i * 5.5, y: "-50%" }}
          animate={open ? { opacity: 0, scale: 0.3 } : { opacity: 1, scale: 1 }}
          transition={{
            duration: 0.2,
            ease: EASE,
            // Outer dots first on the way out; on the way back they refill in
            // reading order behind the cross retracting.
            delay: open ? Math.abs(1 - i) * 0.05 : 0.16 + i * 0.05,
          }}
        />
      ))}

      {[45, -45].map((angle) => (
        <motion.span
          key={angle}
          className="absolute top-1/2 left-0 h-[1.5px] w-4 origin-center rounded-full bg-current"
          style={{ y: "-50%", rotate: angle }}
          animate={{ scaleX: open ? 1 : 0 }}
          transition={{ duration: 0.28, ease: EASE, delay: open ? 0.14 : 0 }}
        />
      ))}
    </span>
  );
}
