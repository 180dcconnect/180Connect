"use client";

import { motion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";

import { CTA_FILL, LIFT, ctaArrow, ctaDisc, ctaLabel, ctaWash } from "./motion";
import { GLASS, GROUND, INK, LABEL_REST, LIME, LIP, SHEET_TINT } from "./tokens";

const MotionLink = motion.create(Link);

/**
 * `glass` sits on the bone page: charcoal capsule, lime accent, and a
 * backdrop-blur that bites on whatever is behind it. `sheet` is its twin inside
 * the open menu, white everywhere the other is lime — and with no blur, because
 * the sheet is flat ink and there is nothing behind it to pick up.
 */
type Tone = "glass" | "sheet";

/** `lg` is the hero pair (40px), `sm` the nav and sheet pair (36px). */
type Size = "sm" | "lg";

const TONES = {
  glass: {
    pill: GLASS,
    accent: LIME,
    /** The surface the disc sits on, so its ring reads as background showing through. */
    ringOn: GLASS,
    blur: "backdrop-blur-md",
    focus: INK,
  },
  sheet: {
    pill: SHEET_TINT,
    accent: GROUND,
    ringOn: INK,
    blur: "",
    focus: GROUND,
  },
} as const;

type CtaProps = {
  label?: string;
  tone?: Tone;
  size?: Size;
  className?: string;
};

/**
 * The two capsules themselves: a label pill and a disc meeting at a single
 * tangent point, never merged into one shape. The lens-shaped slivers above and
 * below where they touch are the whole point — do not close the gap.
 *
 * Hover runs as a staged chain rather than one simultaneous change; the ordering
 * and the reasons behind the odd-looking offsets live in ./motion.ts.
 */
function CtaBody({
  label,
  tone,
  size,
}: {
  label: ReactNode;
  tone: Tone;
  size: Size;
}) {
  const t = TONES[tone];
  const large = size === "lg";

  // 26px clears half a 40px disc plus half the icon, 22px half a 36px one. The
  // small pair also fires on the hover frame instead of waiting on the fill
  // stage — at nav scale that wait reads as lag.
  const arrow = ctaArrow(large ? 26 : 22, large ? CTA_FILL : 0);

  return (
    <>
      {/* Both halves share a height so the disc stays a circle and the two keep
          meeting at a single tangent point. overflow-hidden clips the oversized
          wash block to the pill's rounded shape. */}
      <motion.span
        className={`relative flex items-center overflow-hidden rounded-full ring-1 ring-white/25 ${t.blur} ${
          large ? "h-10 px-6" : "h-9 px-4 sm:px-5"
        }`}
        style={{ backgroundColor: t.pill, boxShadow: LIP }}
      >
        {/* Wide enough that its square trailing edge never enters frame — only
            the rounded leading edge is ever on screen. The 1px vertical bleed is
            load-bearing; see ctaWash. */}
        <motion.span
          variants={ctaWash}
          className="absolute -inset-y-[1px] block w-[999px] rounded-l-full"
          style={{ backgroundColor: t.accent }}
          aria-hidden="true"
        />
        <motion.span
          variants={ctaLabel(LABEL_REST, INK)}
          className={`relative z-10 whitespace-nowrap font-body font-medium ${
            large ? "text-sm" : "text-xs sm:text-sm"
          }`}
        >
          {label}
        </motion.span>
      </motion.span>

      {/* Accent disc inset inside a dark ring, so the dark reads as a ring
          around it rather than the whole token going accent-coloured.
          overflow-hidden is what sells the arrow's loop-through: it vanishes at
          the rim instead of drifting outside the circle. */}
      <motion.span
        variants={ctaDisc(t.ringOn)}
        className={`relative flex items-center justify-center overflow-hidden rounded-full ${
          large ? "h-10 w-10" : "h-9 w-9"
        }`}
        style={{ backgroundColor: t.accent, color: INK }}
      >
        <motion.span variants={arrow} className="flex">
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
    </>
  );
}

const shell =
  "inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-4";

/** The signature action of the public site, as a link. */
export function BrandCta({
  href,
  label = "Get Started",
  tone = "glass",
  size = "lg",
  onClick,
  ariaLabel,
  className = "",
}: CtaProps & {
  href: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  return (
    <MotionLink
      href={href}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`${shell} ${className}`}
      style={{ outlineColor: TONES[tone].focus }}
      initial="rest"
      animate="rest"
      whileHover="hover"
      whileTap={{ scale: size === "lg" ? 0.97 : 0.96 }}
      variants={{ rest: { y: 0 }, hover: { y: -2 } }}
      transition={LIFT}
    >
      <CtaBody label={label} tone={tone} size={size} />
    </MotionLink>
  );
}

/**
 * The same CTA as a real `<button>`, for the one action per form that submits
 * it. Disabled drops the hover chain entirely rather than running it against a
 * dimmed capsule, which reads as a live control that has stopped responding.
 */
export function BrandCtaButton({
  label,
  tone = "glass",
  size = "lg",
  type = "submit",
  disabled,
  describedBy,
  onClick,
  ariaLabel,
  className = "",
}: CtaProps & {
  label: ReactNode;
  type?: "submit" | "button";
  disabled?: boolean;
  describedBy?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      className={`${shell} disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      style={{ outlineColor: TONES[tone].focus }}
      initial="rest"
      animate="rest"
      whileHover={disabled ? undefined : "hover"}
      whileTap={disabled ? undefined : { scale: size === "lg" ? 0.97 : 0.96 }}
      variants={{ rest: { y: 0 }, hover: { y: -2 } }}
      transition={LIFT}
    >
      <CtaBody label={label} tone={tone} size={size} />
    </motion.button>
  );
}
