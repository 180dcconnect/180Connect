"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { EASE } from "@/components/brand/motion";

/**
 * One word in a sentence that happens to be a control.
 *
 * "Clients sorted by city, descending" reads as a line of prose — the two
 * variable words carry a dotted underline and nothing else until the pointer is
 * on them, so the sentence stays a sentence rather than turning into a toolbar
 * of dropdowns. The affordance is the underline plus the caret that fades in on
 * hover/focus; that is deliberately the whole of it.
 *
 * State lives in the URL like every other filter on this page, so a sorted
 * breakdown survives a refresh and can be pasted to someone else. `page` is
 * dropped on change: the breakdown and the list's pagination are unrelated, and
 * keeping page 4 while the view under it changes is the confusing option.
 */
export function SortMenu({
  param,
  value,
  options,
  ariaLabel,
  tone = "light",
}: {
  param: string;
  value: string;
  options: { value: string; label: string }[];
  ariaLabel: string;
  /** Which surface the sentence sits on. The report card is the dark one. */
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const menuId = useId();

  // The card this control lives in clips its content to round its corners, so
  // a menu with too little room below it — the last row in a short breakdown,
  // say — gets cut off mid-item instead of overlapping the row underneath.
  // Portalling to `document.body` and positioning by the trigger's own rect
  // escapes that ancestor's `overflow-hidden` instead of fighting it.
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const current = options.find((option) => option.value === value) ?? options[0];

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setCoords({ top: rect.bottom + 10, left: rect.left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Pointerdown rather than click, matching BrandSearchBar: a drag that starts on
  // a menu row and ends off it should not close the menu under the cursor.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const choose = (next: string) => {
    setOpen(false);
    // Read straight off the address bar rather than through `useSearchParams`:
    // the hook opts every page holding this component out of static rendering,
    // and this only ever runs from a click, where `window` is always there.
    const params = new URLSearchParams(window.location.search);
    params.set(param, next);
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `/clients?${qs}` : "/clients", { scroll: false });
  };

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className={`group inline-flex items-baseline gap-1 rounded-sm tracking-normal underline decoration-dotted underline-offset-[6px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
          dark
            ? "text-[#f4f4ef] decoration-[#f4f4ef]/30 hover:decoration-[#e6f5c0] focus-visible:outline-[#e6f5c0]"
            : "text-foreground decoration-foreground/25 hover:decoration-foreground/60 focus-visible:outline-brand"
        }`}
      >
        {current.label}
        <span
          aria-hidden="true"
          className={`text-[9px] leading-none transition-opacity ${
            open ? "opacity-60" : "opacity-0 group-hover:opacity-45 group-focus-visible:opacity-45"
          }`}
        >
          ▾
        </span>
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              // A span, not a `ul`: this control is a word inside a sentence, and
              // the sentence is a `<p>`. A list — or any block element — inside a
              // paragraph is invalid HTML, and the parser closes the `<p>` early,
              // which shows up as a hydration mismatch. `role="listbox"` carries
              // the semantics the markup no longer does, and the options are the
              // buttons themselves rather than buttons wrapped in rows, which is
              // what a listbox wants anyway.
              //
              // Portalled to `document.body` and positioned by fixed coordinates
              // rather than `absolute`-in-place: the trigger sits inside a card
              // that clips its own content to keep its corners rounded, and a
              // menu positioned relative to that card would get cut off by the
              // same clip. `tracking-normal` here is deliberate too — this
              // sentence carries tight tracking for its prose, and inheritance
              // would otherwise carry that into the menu's option list.
              <motion.span
                ref={menuRef}
                id={menuId}
                role="listbox"
                initial={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
                transition={{ duration: 0.22, ease: EASE }}
                style={{ position: "fixed", top: coords.top, left: coords.left }}
                className={`z-50 block min-w-[180px] overflow-hidden rounded-2xl border p-1 tracking-normal shadow-lg ${
                  dark ? "border-[#f4f4ef]/12 bg-[#161b21]" : "border-black/[0.06] bg-white"
                }`}
              >
                {options.map((option) => {
                  const selected = option.value === current.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => choose(option.value)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 ${
                        dark
                          ? `hover:bg-[#f4f4ef]/[0.07] focus-visible:outline-[#e6f5c0] ${
                              selected ? "font-bold text-[#f4f4ef]" : "text-[#f4f4ef]/70"
                            }`
                          : `hover:bg-black/[0.04] focus-visible:outline-brand ${
                              selected ? "font-bold text-foreground" : "text-foreground/70"
                            }`
                      }`}
                    >
                      {option.label}
                      {selected && (
                        <span aria-hidden="true" className={dark ? "text-[#e6f5c0]" : "text-brand"}>
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </motion.span>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}
