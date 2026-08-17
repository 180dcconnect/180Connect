"use client";

import { MotionConfig, motion } from "motion/react";
import { entranceSoft, stagger } from "@/components/brand/motion";

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
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={entranceSoft} className={className}>
      {children}
    </motion.div>
  );
}
