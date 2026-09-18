"use client";

import { motion, useReducedMotionConfig } from "motion/react";

/**
 * The app's tick, drawn on — the same path and stroke the animated checkbox
 * draws (`animate-ui/primitives/radix/checkbox.tsx`), so a verified field and a
 * ticked box read as one gesture. Used inside a field to say "this checked out".
 */
export function AnimatedTick({
  className = "size-4",
  label = "Verified",
}: {
  className?: string;
  label?: string;
}) {
  const reduceMotion = useReducedMotionConfig();

  return (
    <motion.svg
      animate={{ opacity: 1, scale: 1 }}
      aria-label={label}
      className={`text-go ${className}`}
      fill="none"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
      role="img"
      stroke="currentColor"
      strokeWidth={3}
      transition={{ duration: 0.18 }}
      viewBox="0 0 24 24"
    >
      <motion.path
        animate={{ pathLength: 1 }}
        d="M4.5 12.75l6 6 9-13.5"
        initial={reduceMotion ? false : { pathLength: 0 }}
        strokeLinecap="round"
        strokeLinejoin="round"
        transition={{ duration: 0.3, delay: 0.08 }}
      />
    </motion.svg>
  );
}
