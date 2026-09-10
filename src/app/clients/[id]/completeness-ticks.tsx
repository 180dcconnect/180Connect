"use client";

import { motion } from "motion/react";

import type { CompletenessItem, CompletenessResult } from "@/lib/client-completeness";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";

/**
 * The completeness strip: four chips, each ticked or not.
 *
 * Missing signals stay on screen rather than being filtered out. That is the
 * point — a filtered strip would say "this record has a registration number"
 * and leave the CAM to notice, by absence, that nobody knows what the
 * organisation earns. An untickled box says it outright, and because the four
 * chips sit in the same order on every record, the shape of the strip is
 * comparable between two clients at a glance without reading a word of it.
 *
 * The tick is the animate-ui checkbox's mark, not the checkbox itself. That
 * component (`components/animate-ui/primitives/radix/checkbox.tsx`) is a Radix
 * root — a focusable button a keyboard user can tab into and toggle — and these
 * are readings of the record, not settings anyone can change. So the mark's
 * path and its draw timing are reused verbatim while the interactive shell is
 * not, and the row is a plain list. Same movement on screen, honest semantics
 * underneath.
 *
 * A client component only because the draw is a motion path. Everything it
 * needs arrives as one serialisable prop from the server header.
 */

/** The animate-ui checkbox mark: same path, same pathLength draw. */
function TickMark({ delay }: { delay: number }) {
  return (
    <motion.svg
      aria-hidden="true"
      className="size-3 text-white"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <motion.path
        d="M4.5 12.75l6 6 9-13.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.2, delay }}
      />
    </motion.svg>
  );
}

/**
 * The box. Green and filled when held, hollow when not — the same footprint
 * either way, so the chips keep their rhythm and only the state changes.
 */
function TickBox({ present, delay }: { present: boolean; delay: number }) {
  if (!present) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-rule bg-white"
      />
    );
  }

  return (
    <motion.span
      aria-hidden="true"
      className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-go"
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.18, delay: Math.max(0, delay - 0.12) }}
    >
      <TickMark delay={delay} />
    </motion.span>
  );
}

function Chip({ item, index }: { item: CompletenessItem; index: number }) {
  // Left to right, a beat apart, so the strip reads as a checklist filling in
  // rather than four things appearing at once.
  const delay = 0.18 + index * 0.09;

  return (
    <li>
      <InfoTooltip
        content={item.detail}
        side="top"
        sideOffset={4}
        delayDuration={200}
      >
        <span
          className={
            item.present
              ? "inline-flex cursor-help items-center gap-2 rounded-inset border border-rule bg-white py-1 pr-2.5 pl-1.5 text-[12.5px] text-ink"
              : "inline-flex cursor-help items-center gap-2 rounded-inset border border-dashed border-rule bg-paper py-1 pr-2.5 pl-1.5 text-[12.5px] text-faint"
          }
        >
          <TickBox delay={delay} present={item.present} />
          <span>{item.label}</span>
          <span className="sr-only">{item.present ? "— on file" : "— not held"}</span>
        </span>
      </InfoTooltip>
    </li>
  );
}

export function CompletenessTicks({
  completeness,
  className,
}: {
  completeness: CompletenessResult;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {completeness.items.map((item, index) => (
        <Chip index={index} item={item} key={item.key} />
      ))}
    </ul>
  );
}
