"use client";

import * as React from "react";
import { motion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CTA_FILL, CTA_WASH, LIFT, ctaArrow, ctaDisc, ctaLabel, ctaWash } from "./motion";
import { GLASS, INK, LABEL_REST, LIME, LIP } from "./tokens";

export interface GooeyBrandCtaProps {
  /** Label inside the primary pill. Defaults to "Get Started" */
  label?: ReactNode;
  /** Click callback */
  onClick?: () => void;
  /** Link href if behaving as an anchor */
  href?: string;
  /** Size preset ('sm' for nav 36px, 'lg' for hero 40px) */
  size?: "sm" | "lg";
  /** Delay before arrow disc begins budding out (in ms) */
  entranceDelay?: number;
  /** Duration of emergence animation (in ms) */
  duration?: number;
  /** Goo blur strength */
  gooBlur?: number;
  /** Alpha contrast slope */
  gooContrast?: number;
  /** Force detached state (for static previews) */
  forceOpen?: boolean;
  /** Accessible aria label */
  ariaLabel?: string;
  /** Custom class */
  className?: string;
}

export function GooeyBrandCta({
  label = "Get Started",
  onClick,
  href,
  size = "lg",
  entranceDelay = 250,
  duration = 640,
  gooBlur = 6,
  gooContrast = 14,
  forceOpen,
  ariaLabel,
  className = "",
}: GooeyBrandCtaProps) {
  const [hasDetached, setHasDetached] = React.useState(forceOpen ?? false);
  const [isEmerging, setIsEmerging] = React.useState(forceOpen === undefined);
  const [isHovered, setIsHovered] = React.useState(false);
  const large = size === "lg";

  const discSize = large ? 40 : 36;
  const arrow = ctaArrow(large ? 26 : 22, large ? CTA_FILL : 0);

  // Trigger the budding animation after mount + delay
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let endTimer: ReturnType<typeof setTimeout>;

    const raf = requestAnimationFrame(() => {
      if (forceOpen !== undefined) {
        setHasDetached(forceOpen);
        setIsEmerging(false);
        return;
      }
      setIsEmerging(true);
      timer = setTimeout(() => {
        setHasDetached(true);
        // Cleanly complete emergence after animation duration
        endTimer = setTimeout(() => {
          setIsEmerging(false);
        }, duration + 100);
      }, entranceDelay);
    });

    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      if (endTimer) clearTimeout(endTimer);
    };
  }, [entranceDelay, duration, forceOpen]);

  // Unique SVG filter ID for this instance
  const filterId = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");

  // Spring / ease transition configuration for emergence
  const emergenceTransition = {
    duration: duration / 1000,
    ease: [0.4, 0, 0.2, 1] as const,
  };

  const content = (
    <div
      className={`relative inline-flex items-center select-none ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* SVG Gooey Filter Definition */}
      <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
        <defs>
          <filter id={`goo-filter-${filterId}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={gooBlur / 2} result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${gooContrast * 3} -${gooContrast * 1.5}`}
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      {/* Temporary Liquid Neck Bridge — only visible during active emergence to avoid double opacity */}
      {isEmerging && (
        <div
          className="absolute inset-0 flex items-center pointer-events-none z-0"
          style={{ filter: `url(#goo-filter-${filterId})` }}
          aria-hidden="true"
        >
          {/* Right edge capsule anchor */}
          <div
            className="rounded-full ml-auto"
            style={{
              backgroundColor: GLASS,
              width: `${discSize}px`,
              height: `${discSize}px`,
              marginRight: `${discSize}px`,
            }}
          />
          {/* Moving disc silhouette */}
          <motion.div
            initial={{ x: -(discSize - 4), opacity: 0 }}
            animate={{
              x: hasDetached ? 0 : -(discSize - 4),
              opacity: hasDetached ? 1 : 0,
            }}
            transition={emergenceTransition}
            className="rounded-full shrink-0"
            style={{
              width: `${discSize}px`,
              height: `${discSize}px`,
              backgroundColor: GLASS,
            }}
          />
        </div>
      )}

      {/* Main Interactive Button Pair (Single layer of GLASS — 100% identical to BrandCta) */}
      <motion.div
        className="relative z-10 inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-4"
        style={{ outlineColor: INK }}
        initial="rest"
        animate={isHovered ? "hover" : "rest"}
        whileTap={{ scale: large ? 0.97 : 0.96 }}
        variants={{ rest: { y: 0 }, hover: { y: -2 } }}
        transition={LIFT}
      >
        {/* 1. The "Get Started" Label Pill */}
        <motion.span
          className={`relative flex items-center overflow-hidden rounded-full ring-1 ring-white/25 ${
            large ? "h-10 px-6" : "h-9 px-4 sm:px-5"
          }`}
          style={{ boxShadow: LIP }}
        >
          {/* Single authentic dark glass underlay */}
          <motion.span
            className="pointer-events-none absolute inset-0 rounded-full backdrop-blur-md"
            style={{ backgroundColor: GLASS }}
            variants={{
              rest: { opacity: 1, transition: { duration: 0.2 } },
              hover: { opacity: 0, transition: { duration: CTA_WASH, delay: CTA_FILL } },
            }}
            aria-hidden="true"
          />

          {/* Directional lime wash background sweep on hover */}
          <motion.span
            variants={ctaWash}
            className="absolute -inset-y-[2px] left-full block w-[200%] rounded-l-full"
            style={{ backgroundColor: LIME }}
            aria-hidden="true"
          />

          {/* Label typography */}
          <motion.span
            variants={ctaLabel(LABEL_REST, INK)}
            className={`relative z-10 whitespace-nowrap font-body font-medium ${
              large ? "text-sm" : "text-xs sm:text-sm"
            }`}
          >
            {label}
          </motion.span>
        </motion.span>

        {/* 2. The Accent Disc (Starts inside pill, emerges to exact tangent point) */}
        <motion.span
          initial={{ x: -(discSize - 4), opacity: 0, scale: 0.8 }}
          animate={{
            x: hasDetached ? 0 : -(discSize - 4),
            opacity: hasDetached ? 1 : 0,
            scale: hasDetached ? 1 : 0.8,
          }}
          transition={emergenceTransition}
          variants={ctaDisc(GLASS)}
          className={`relative flex items-center justify-center overflow-hidden rounded-full ${
            large ? "h-10 w-10" : "h-9 w-9"
          }`}
          style={{
            backgroundColor: LIME,
            color: INK,
            pointerEvents: hasDetached ? "auto" : "none",
          }}
        >
          <motion.span
            variants={arrow}
            className="flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: hasDetached ? 1 : 0 }}
            transition={{ delay: (duration / 1000) * 0.4, duration: 0.25 }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={large ? "h-4 w-4" : "h-[15px] w-[15px]"}
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </motion.span>
        </motion.span>
      </motion.div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} onClick={onClick} aria-label={ariaLabel} className="inline-block">
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="inline-block bg-transparent border-0 p-0 cursor-pointer focus-visible:outline-none"
    >
      {content}
    </button>
  );
}
