"use client";

import { motion } from "motion/react";
import Image from "next/image";

import { EASE } from "./motion";

/** Base delay before the first wordmark token appears, in seconds. */
const WM_DELAY = 0.2;
/** Gap between each successive token (globe + 10 chars). */
const WM_STAGGER = 0.045;
/** How long each token takes to resolve. */
const WM_DURATION = 0.5;

/**
 * `scroll` mode renders the wordmark at a size driven entirely by the inherited
 * `--t` CSS variable (1 = full splash size, 0 = resting nav size): every
 * dimension is a `calc()` mixing the two endpoints, so native CSS re-evaluates
 * it on every frame with zero React re-renders. It also splits the label into
 * per-character spans that blur in one after another.
 *
 * Without `scroll`, it's just the fixed small wordmark — used in the top bar of
 * ordinary pages, and inside the menu sheet, which never scales with the page.
 */
export function Wordmark({
  tone,
  scroll,
}: {
  tone: "light" | "dark";
  scroll?: boolean;
}) {
  /** Split only in scroll mode — the sheet copy is never re-mounted, so it has
   *  no entrance of its own; it's revealed by the clip-path circle. */
  const chars = scroll ? "180Connect".split("") : null;

  return (
    <div
      className={`flex items-center font-body font-black tracking-tight ${
        tone === "light" ? "text-white" : "text-[#0c1014]"
      } ${
        scroll
          ? "text-[calc(clamp(3rem,14.5vw,15rem)*var(--t,1)+1.5rem*(1_-_var(--t,1)))] min-[1700px]:text-[calc(17.2rem*var(--t,1)+1.5rem*(1_-_var(--t,1)))]"
          : "gap-3 text-2xl"
      }`}
      style={
        scroll
          ? { gap: "calc(1.75rem * var(--t, 1) + 0.75rem * (1 - var(--t, 1)))" }
          : undefined
      }
    >
      {/* Globe mark only — the source lockup's wordmark is white and would
          disappear against the light page. The white variant is the same mark
          stencilled from its own alpha, so it swaps in cleanly on the dark menu
          sheet where the green reads muddy.
          `scroll` mode sizes via `fill` on a calc()'d wrapper instead of
          width/height props: two independently-rounded identical `calc()`
          expressions can land a sub-pixel apart, and Next's Image warns about
          "aspect ratio changed" whenever the rendered box doesn't exactly match
          the width/height attributes — fill sidesteps that check. The min-h/min-w
          floor is the settled size, so it's a no-op visually but keeps the box
          from collapsing to 0 (and the image with it) in the frame before `--t`
          resolves. */}
      {scroll ? (
        <motion.div
          initial={{ opacity: 0, filter: "blur(10px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: WM_DURATION, ease: EASE, delay: WM_DELAY }}
          className="relative h-[calc(clamp(2.6rem,12.6vw,13rem)*var(--t,1)+2.25rem*(1_-_var(--t,1)))] min-h-9 w-[calc(clamp(2.6rem,12.6vw,13rem)*var(--t,1)+2.25rem*(1_-_var(--t,1)))] min-w-9 shrink-0 min-[1700px]:h-[calc(14.5rem*var(--t,1)+2.25rem*(1_-_var(--t,1)))] min-[1700px]:w-[calc(14.5rem*var(--t,1)+2.25rem*(1_-_var(--t,1)))]"
        >
          <Image
            src={tone === "light" ? "/180dc-globe-white.png" : "/180dc-globe.png"}
            alt=""
            fill
            sizes="280px"
            className="object-contain"
          />
        </motion.div>
      ) : (
        <Image
          src={tone === "light" ? "/180dc-globe-white.png" : "/180dc-globe.png"}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 object-contain"
        />
      )}
      {/* In scroll mode each character is its own motion.span with an explicit
          delay. The wrapping span keeps them as a single flex item so the gap
          only fires between the globe and the text block, not between every
          letter. The sr-only span keeps the label atomic for screen readers. */}
      {chars ? (
        <>
          <span className="sr-only">180Connect</span>
          <span aria-hidden="true" className="inline-block">
            {chars.map((char, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, filter: "blur(10px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                transition={{
                  duration: WM_DURATION,
                  ease: EASE,
                  // token 0 is the globe, so chars start at index 1
                  delay: WM_DELAY + (i + 1) * WM_STAGGER,
                }}
                className="inline-block"
              >
                {char}
              </motion.span>
            ))}
          </span>
        </>
      ) : (
        <span>180Connect</span>
      )}
    </div>
  );
}

/**
 * Hand-drawn tree used as the menu sheet's corner motif. The source PNG is white
 * line-art on a transparent ground, so it needs no keying — opacity alone gives
 * it the low-contrast, drawn-on feel.
 */
export function TreeMark() {
  return (
    <Image
      src="/try.png"
      alt=""
      fill
      sizes="(max-width: 640px) 60vw, 660px"
      className="object-contain object-bottom"
      priority={false}
    />
  );
}
