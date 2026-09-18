"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes, Ref } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface BookmarkPlusIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface BookmarkPlusIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  /** Row-level driver: the row calls start/stop on its own hover. */
  animationRef?: Ref<BookmarkPlusIconHandle>;
}

const BOOKMARK_VARIANTS: Variants = {
  normal: { scaleY: 1, scaleX: 1 },
  animate: {
    scaleY: [1, 1.3, 0.9, 1.05, 1],
    scaleX: [1, 0.9, 1.1, 0.95, 1],
    transition: {
      duration: 0.6,
      ease: "easeOut",
    },
  },
};

const PLUS_LINE_VARIANTS: Variants = {
  normal: { strokeDashoffset: 0, opacity: 1 },
  animate: (i: number) => ({
    strokeDashoffset: [1, 0],
    opacity: 1,
    transition: {
      duration: 0.3,
      ease: "easeOut",
      delay: i * 0.1,
    },
  }),
};

const BookmarkPlusIcon = forwardRef<
  BookmarkPlusIconHandle,
  BookmarkPlusIconProps
>(({ className, size = 20, animationRef, onMouseEnter, onMouseLeave, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  const handle: BookmarkPlusIconHandle = {
    startAnimation: () => controls.start("animate"),
    stopAnimation: () => controls.start("normal"),
  };

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return handle;
  });

  // Forward the same handle to the row-level animationRef so the sidebar row
  // can drive the correct squish animation on row hover.
  useImperativeHandle(animationRef, () => {
    isControlledRef.current = true;
    return handle;
  });

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseEnter?.(e);
      } else {
        controls.start("animate");
      }
    },
    [controls, onMouseEnter]
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseLeave?.(e);
      } else {
        controls.start("normal");
      }
    },
    [controls, onMouseLeave]
  );

  return (
    <div
      className={cn(className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <motion.path
          animate={controls}
          d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"
          style={{ originX: 0.5, originY: 0.5 }}
          variants={BOOKMARK_VARIANTS}
        />

        <motion.line
          animate={controls}
          custom={0}
          initial="normal"
          pathLength="1"
          strokeDasharray="1 1"
          variants={PLUS_LINE_VARIANTS}
          x1="12"
          x2="12"
          y1="7"
          y2="13"
        />
        <motion.line
          animate={controls}
          custom={1}
          initial="normal"
          pathLength="1"
          strokeDasharray="1 1"
          variants={PLUS_LINE_VARIANTS}
          x1="15"
          x2="9"
          y1="10"
          y2="10"
        />
      </svg>
    </div>
  );
});

BookmarkPlusIcon.displayName = "BookmarkPlusIcon";

export { BookmarkPlusIcon };
