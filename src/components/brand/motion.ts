import type { Variants } from "motion/react";
import { LIP } from "./tokens";

/**
 * One curve for the whole public site. Anything that eases and isn't the menu
 * sheet uses this.
 */
export const EASE = [0.2, 0.7, 0.2, 1] as const;

/**
 * The sheet's circle is the one exception. EASE is front-loaded and blows the
 * circle past full radius within ~120ms, so the reveal never reads as a circle;
 * this one eases *in*, holding the small disc under the burger long enough to
 * see.
 */
export const SHEET_EASE = [0.76, 0, 0.24, 1] as const;

/** Hover lift shared by every interactive brand element. */
export const LIFT = { type: "spring", stiffness: 420, damping: 28 } as const;

/* ─── Entrance ─────────────────────────────────────────────────────────── */

/**
 * Parent of a group that should arrive in reading order. `delayChildren` is set
 * per page — a landing splash holds its copy back behind the intro, a legal page
 * starts almost immediately.
 */
export const stagger = (staggerChildren = 0.09, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren, delayChildren } },
});

/**
 * The house entrance: opacity, a short rise, and a blur-up. The blur is what
 * makes it read as this site rather than a generic fade — do not drop it.
 */
export const entrance: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(12px)", scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    scale: 1,
    transition: { duration: 0.75, ease: EASE },
  },
};

/** Lighter entrance for long-form pages, where the full blur is too heavy. */
export const entranceSoft: Variants = {
  hidden: { opacity: 0, y: 20, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: EASE },
  },
};

/**
 * `entranceSoft` for a list long enough that `staggerChildren` would run away
 * with it — a hundred audit rows at 0.04s apart is a four-second cascade, and
 * the reader is left watching the bottom of the page fill in.
 *
 * Pass the row's index as Motion's `custom`. The delay grows with the index and
 * then stops: everything above the fold still arrives in reading order, and
 * everything below it is already settled by the time it is scrolled to.
 */
export const entranceIndexed = (step = 0.035, cap = 0.6): Variants => ({
  hidden: { opacity: 0, y: 16, filter: "blur(6px)" },
  show: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: EASE, delay: Math.min(index * step, cap) },
  }),
});

/* ─── Menu sheet ───────────────────────────────────────────────────────── */

/**
 * Opens as a circle under the burger and swells until it engulfs the screen. The
 * origin is a rough average of where the button lands across breakpoints; 150%
 * is enough radius to clear the far corner.
 */
export const SHEET_ORIGIN = "95% 5%";

export const sheet: Variants = {
  hidden: { clipPath: `circle(0% at ${SHEET_ORIGIN})` },
  show: {
    clipPath: `circle(150% at ${SHEET_ORIGIN})`,
    transition: {
      duration: 0.85,
      ease: SHEET_EASE,
      staggerChildren: 0.06,
      delayChildren: 0.45,
    },
  },
  exit: {
    clipPath: `circle(0% at ${SHEET_ORIGIN})`,
    transition: { duration: 0.6, ease: SHEET_EASE, staggerChildren: 0.04 },
  },
};

export const sheetItem: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
  exit: { opacity: 0, y: 12, transition: { duration: 0.2, ease: EASE } },
};

/* ─── CTA hover chain ──────────────────────────────────────────────────── */

/**
 * Hover on a CTA runs as a chain, not one simultaneous change:
 *   1. the accent disc swells to swallow its own dark ring,
 *   2. only then does the accent wash leftward across the label capsule,
 *   3. the label flips once the wash is under it,
 *   4. the arrow darts out and back while that wash travels.
 * These two delays encode the ordering; each stage starts as the previous lands.
 * Leaving hover reverses everything at once, quickly.
 */
export const CTA_FILL = 0.22;
export const CTA_WASH = 0.38;

/**
 * The disc is permanently accent-coloured, with the dark ring drawn as an *inset
 * shadow* that shrinks to nothing. Not a gradient and not a child element: a
 * gradient animated here left a faint seam once Chrome promoted the element to
 * its own layer, and a stacked child is antialiased against the rounded clip
 * independently — compositing a dark hairline that no overshoot removes. An
 * inset shadow rasterises together with the background, so the element has
 * exactly one antialiased edge and nothing can peek out from under it.
 *
 * `ringColor` is the surface the disc sits on: the glass charcoal on the bone
 * page, the sheet's own ink on the menu, so in both cases the ring reads as the
 * background showing through a gap rather than as a painted stroke.
 */
export const ctaDisc = (ringColor: string): Variants => ({
  rest: {
    boxShadow: `inset 0 0 0 3px ${ringColor}, ${LIP}`,
    transition: { duration: 0.25, ease: EASE },
  },
  hover: {
    boxShadow: `inset 0 0 0 0px ${ringColor}, ${LIP}`,
    transition: { duration: CTA_FILL, ease: EASE },
  },
});

/**
 * The fill's leading edge is the pill's own end-cap, reused rather than redrawn:
 * a `rounded-l-full` block at the pill's full height caps its radius at height/2
 * exactly like `rounded-full` does on the pill itself.
 *
 * It settles past the left edge rather than flush against it, and that matters.
 * This block's `rounded-l-full` and the parent's `overflow-hidden` clip are two
 * independently antialiased curves, and browsers subpixel-round them a hair
 * apart — so flush, the parent's dark background shows through as a hairline at
 * the arc even though both radii resolve to the same number on paper. Driving
 * the cap past the parent's corner entirely leaves the flat part of the
 * rectangle for the corner to clip: one curve draws the edge, not two fighting
 * over it.
 *
 * The element is `-inset-y-[2px]` and `w-[200%]` at the call site, anchored at
 * the pill's right edge. Travel runs as a transform (`x`), not `left`: `left`
 * forces layout plus a repaint every frame, which Safari stutters on behind the
 * pill's backdrop-blur, while a transform composites on the GPU. The element is
 * twice the pill's width, so the settle point is -60% of its own width: from
 * 100% (fully off right) to -20% of the pill.
 */
export const ctaWash: Variants = {
  rest: { x: "0%", transition: { duration: 0.28, ease: EASE } },
  hover: {
    x: "-60%",
    transition: { duration: CTA_WASH, ease: EASE, delay: CTA_FILL },
  },
};

export const ctaLabel = (restColor: string, hoverColor: string): Variants => ({
  rest: { color: restColor, transition: { duration: 0.2 } },
  // Flips once the wash is far enough left to be under the text.
  hover: { color: hoverColor, transition: { duration: 0.18, delay: CTA_FILL + 0.1 } },
});

/**
 * The arrow exits stage right, then re-enters from the left — the jump between
 * the two is instantaneous and happens while it is outside the disc, which clips
 * it, so the eye reads one arrow travelling through rather than two.
 *
 * `travel` clears half the disc plus half the icon: 26px on a 40px hero disc,
 * 22px on a 36px nav disc. The nav's dart also fires on the hover frame rather
 * than waiting on the fill stage — at that scale the wait reads as lag.
 */
export const ctaArrow = (travel: number, delay: number): Variants => ({
  rest: { x: 0, transition: { duration: 0.25, ease: EASE } },
  hover: {
    x: [0, travel, -travel, 0],
    transition: {
      duration: delay ? 0.7 : 0.6,
      delay,
      times: [0, 0.45, 0.4501, 1],
      ease: EASE,
    },
  },
});
