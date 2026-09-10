"use client";

import { useRef } from "react";
import { MotionConfig, motion } from "motion/react";
import { entranceSoft, entranceSoftFlat, stagger } from "@/components/brand/motion";

/**
 * The dashboard's entrance, built from the shared brand variants rather than a
 * second copy of them (docs/design-system.md §Source of truth). The app is not
 * held to the public system's *palette* — it keeps the shadcn tokens — but its
 * motion is the one thing that should read as the same product: content arrives
 * in reading order, blurring up, never all at once.
 *
 * `entranceSoft` rather than `entrance`: the full 12px blur is tuned for a
 * landing hero and reads as a smear on a dense grid of numbers.
 *
 * Server components can be passed straight through these — they only wrap.
 */

/** Top-level container. One per screen: it owns the reduced-motion contract. */
export function Stage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        variants={stagger(0.08)}
        initial="hidden"
        animate="show"
        className={className}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}

/**
 * A sub-group whose own children arrive in sequence — a section heading and the
 * cards under it. Nests inside `Stage`: it inherits hidden/show through Motion's
 * context (which follows the React tree, so plain wrapper divs in between are
 * fine) and re-staggers its own children more tightly than the page does.
 */
export function Group({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={stagger(0.05)} className={className}>
      {children}
    </motion.div>
  );
}

/** One arriving element. */
export function Rise({
  children,
  className,
  glass = false,
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * Set on a card that contains a `backdrop-filter` — a frosted search panel,
   * a glass popover. It swaps the blur-up for a plain rise, because a filtered
   * ancestor walls the glass into this card's own backdrop root for good (see
   * `entranceSoftFlat`). The clearing below is the best a filtered Rise can do
   * and it does not survive a re-render, so glass cannot rely on it.
   */
  glass?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  if (glass) {
    return (
      <motion.div variants={entranceSoftFlat} className={className}>
        {children}
      </motion.div>
    );
  }
  return (
    <motion.div
      ref={ref}
      variants={entranceSoft}
      className={className}
      onAnimationComplete={() => {
        // The entrance settles at filter: blur(0px), and any non-none filter
        // makes this a permanent backdrop root — glass inside (search panels,
        // popovers) could then only ever sample this card, never the page
        // behind it, so every backdrop-blur read as flat. Clearing to none
        // once the entrance lands keeps the blur-up arrival without walling
        // off every frosted descendant forever.
        //
        // It only holds until Motion next renders this element, though —
        // Motion owns `filter` and re-flushes the variant's `blur(0px)` over
        // this write, and on a record page that happens the first time the
        // realtime refresher calls `router.refresh()`. A card that actually
        // contains glass must pass `glass` instead of relying on this.
        if (ref.current) ref.current.style.filter = "none";
      }}
    >
      {children}
    </motion.div>
  );
}
