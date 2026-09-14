"use client";

import { useState, type ReactNode } from "react";
import { motion, useReducedMotionConfig } from "motion/react";

import { EASE } from "@/components/brand/motion";

/**
 * One collapsible row: title, a one-line summary of what is inside, and an
 * Edit / Done control — the row language of the Charity Commission filter
 * builder (`FilterSection`), without its save-and-count cycle, which belongs
 * to a live query this page does not have.
 *
 * ── Why the body stays mounted ──
 *
 * `FilterSection` unmounts its body on close, which is fine for controlled
 * filter state that lives above it. The client form is uncontrolled on purpose
 * (see manual-entry-form.tsx), so an unmounted section would lose what was typed
 * and drop its fields from the submitted FormData. Closed here means height 0
 * and `inert` — out of view, out of the tab order, still in the form.
 *
 * ── Why it is controlled ──
 *
 * The parent has to open a section the browser wants to point at (an invalid
 * required field), and collapse the register row once its match has been used.
 * Both need the open state one level up.
 */
export function DisclosureSection({
  id,
  title,
  summary,
  status,
  open,
  onToggle,
  openLabel = "Done",
  closedLabel = "Edit",
  children,
}: {
  /** Stable key, also written to `data-disclosure` so a field can find its section. */
  id: string;
  title: string;
  /** What is in here, in one line. Null renders the quiet placeholder. */
  summary: ReactNode | null;
  /** A dot before the summary: filled, still needs something, or nothing to say. */
  status?: "complete" | "incomplete" | null;
  open: boolean;
  onToggle: () => void;
  openLabel?: string;
  closedLabel?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotionConfig();
  const bodyId = `${id}-body`;
  // Clipping is only needed while the height animates. Once a row has finished
  // opening it stops clipping, so a dropdown inside it (the UK town list) can
  // hang over the rows below instead of being cut off at the row's edge.
  const [settled, setSettled] = useState(open);

  return (
    <section className="border-t border-rule-soft first:border-t-0" data-disclosure={id}>
      <button
        aria-controls={bodyId}
        aria-expanded={open}
        className="group flex w-full cursor-pointer items-center gap-4 py-4 text-left focus-visible:outline-none"
        onClick={onToggle}
        type="button"
      >
        <h3 className="shrink-0 font-body text-[19px] font-normal leading-[1.3] tracking-[-0.01em] text-ink">
          {title}
        </h3>
        <span
          className={`flex min-w-0 flex-1 items-center gap-2 text-[13.5px] ${
            summary ? "text-ink" : "text-faint"
          }`}
        >
          {status && (
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${
                status === "complete" ? "bg-go" : "bg-hold"
              }`}
            />
          )}
          <span className="truncate">{summary ?? "Not started"}</span>
        </span>
        <span
          aria-hidden
          className={`inline-flex shrink-0 items-center rounded-inset border px-2.5 py-1 text-[13px] font-medium transition-colors group-focus-visible:ring-2 group-focus-visible:ring-lead/30 ${
            open
              ? "border-rule bg-white text-dim group-hover:text-ink"
              : "border-rule bg-white text-lead group-hover:border-lead"
          }`}
        >
          {open ? openLabel : closedLabel}
        </span>
      </button>

      <motion.div
        animate={open ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
        className={open && settled ? "overflow-visible" : "overflow-hidden"}
        id={bodyId}
        onAnimationComplete={() => setSettled(open)}
        onAnimationStart={() => setSettled(false)}
        inert={!open}
        initial={false}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: EASE }}
      >
        <div className="pb-5">{children}</div>
      </motion.div>
    </section>
  );
}
