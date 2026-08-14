"use client";

import {
  animate,
  AnimatePresence,
  MotionConfig,
  motion,
  useMotionTemplate,
  useMotionValue,
  useTransform,
  type Variants,
} from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

const MotionLink = motion.create(Link);

/** Matches the old `.rise` curve so the entrance feel is unchanged. */
const EASE = [0.2, 0.7, 0.2, 1] as const;

/**
 * The copy block enters as one staggered run in reading order: wordmark,
 * headline, standfirst, CTA. `delayChildren` holds it back just long enough
 * for the photo squares to have started resolving underneath.
 */
const stack: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.09, delayChildren: 0.75 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(12px)", scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    scale: 1,
    transition: { duration: 0.75, ease: EASE },
  },
};

/**
 * Each square is its own pre-cropped file (see public/crops/, cut from
 * tree2.jpg with sharp) rather than an object-position trick — real close-in
 * detail instead of a shifted-but-still-wide frame. The leaf silhouette (two
 * opposite corners swept, two left sharp) is baked into each PNG rather than
 * clipped in CSS, so the soft one's blur dissolves along the leaf edge instead
 * of being hard-cut by a border-radius.
 *
 * `hero: true` moves a crop out of the scatter and into the layer behind the
 * headline, where left/top read off the viewport instead of the scatter's box.
 * Those are the only crops gated above laptop widths — a laptop keeps exactly
 * the scatter it has now, and the extra ones appear only where a desktop
 * monitor opens up empty space beside the copy.
 */
type CropSpec = {
  left: number;
  top: number;
  size: number;
  src: string;
  className: string;
  hero?: boolean;
};

const squares: CropSpec[] = [
  { left: 42, top: 7, size: 100, src: "/crops/leaf-branch-soft.png", className: "" },
  { left: 17, top: 19, size: 157, src: "/crops/leaf-bark.png", className: "hidden sm:block" },
  { left: 88, top: 11, size: 78, src: "/crops/leaf-branch-soft.png", className: "hidden md:block" },
  { left: 4, top: 15, size: 96, src: "/crops/leaf-vine.png", className: "", hero: true },
  { left: 90, top: 12, size: 78, src: "/crops/leaf-branch-soft.png", className: "", hero: true },
  { left: 13, top: 23, size: 68, src: "/crops/leaf-branch-soft.png", className: "", hero: true },
  { left: 60, top: 34, size: 65, src: "/crops/leaf-branch-soft.png", className: "hidden md:block" },
  { left: 76, top: 32, size: 135, src: "/crops/leaf-vine.png", className: "" },
  { left: 4, top: 43, size: 96, src: "/crops/leaf-vine.png", className: "hidden lg:block" },
  { left: 30, top: 56, size: 242, src: "/crops/leaf-moss.png", className: "" },
  { left: 56, top: 74, size: 178, src: "/crops/leaf-fern.png", className: "hidden sm:block" },
  { left: 86, top: 67, size: 118, src: "/crops/leaf-bark.png", className: "hidden sm:block" },
];

/**
 * The crops resolve on the wordmark's curve and duration rather than the quick
 * blur-up the CTA uses: they swell from small to full size while drifting a
 * short way into place, so the whole scatter reads as one slow settle.
 *
 * Direction reads off the vertical band, not the horizontal one — the upper
 * crops come in from the left, the lower ones from the right, so the scatter
 * converges as it lands instead of sliding across as a single sheet.
 */
const CROP_TRAVEL = 2.2;
const CROP_DRIFT = 36;
const CROP_SCALE = 0.74;

const cropDrift = (top: number) => (top < 50 ? -CROP_DRIFT : CROP_DRIFT);

/**
 * The scatter lands in three waves down the page rather than as one sheet. The
 * bands are the same ones the drift direction reads off, so each wave enters
 * from a single side together and the grouping is legible as a group.
 *
 * `CROP_WAVE` is the gap between one wave's last departure and the next wave's
 * first, so a band can grow without crowding the wave behind it — the top band
 * carries three extra crops on wide screens, which a fixed per-band offset
 * would have run straight into the second wave. `CROP_STEP` offsets the crops
 * within a wave by a hair, enough that they don't land in lockstep without
 * reading as separate arrivals. Raise `CROP_STEP` towards `CROP_WAVE` for a
 * strictly one-at-a-time entrance.
 */
const CROP_START = 2.9;
const CROP_WAVE = 0.75;
const CROP_STEP = 0.12;

const cropBand = (top: number) => (top < 25 ? 0 : top < 50 ? 1 : 2);

/**
 * Resolved once at module scope rather than per render: the delays depend on
 * how the whole list distributes across bands, which is a property of the list,
 * not of the component.
 *
 * Delays are counted off the full list even though the breakpoint classes hide
 * some crops on narrower screens — a hidden crop still holds its slot, so the
 * visible ones keep identical timing at every width instead of resequencing as
 * the viewport crosses a breakpoint.
 */
const cropDelays = (() => {
  const counts = squares.reduce<number[]>((acc, sq) => {
    acc[cropBand(sq.top)] = (acc[cropBand(sq.top)] ?? 0) + 1;
    return acc;
  }, []);

  const waveStarts = counts.reduce<number[]>((acc, count, band) => {
    const previous = acc[band - 1];
    acc[band] =
      band === 0
        ? CROP_START
        : previous + (counts[band - 1] - 1) * CROP_STEP + CROP_WAVE;
    return acc;
  }, []);

  const placed: number[] = [];
  return squares.map((sq) => {
    const band = cropBand(sq.top);
    placed[band] = (placed[band] ?? 0) + 1;
    return waveStarts[band] + (placed[band] - 1) * CROP_STEP;
  });
})();

/**
 * Once a crop has settled it keeps a small idle sway — otherwise the whole
 * scatter goes dead the moment the entrance finishes. Duration and direction
 * are seeded off `index` (not Math.random) so the drift varies crop to crop
 * without a client/server hydration mismatch, and it's a separate inner layer
 * so the loop never fights the one-shot entrance transform on the outer div.
 */
const IDLE_DURATION = 5;
const IDLE_VARY = 1.4;
const IDLE_RISE = 7;
const IDLE_DRIFT = 5;

/**
 * Starts small and off to one side, then grows into place over the same span
 * the wordmark takes to settle. Shared by both layers so a hero crop and a
 * scatter crop cannot drift apart in feel — only where they are positioned
 * differs; `delay` decides which wave it rides in on.
 */
function Crop({ crop, delay, index }: { crop: CropSpec; delay: number; index: number }) {
  const idleDuration = IDLE_DURATION + (index % 5) * (IDLE_VARY / 5);
  const idleDrift = index % 2 === 0 ? IDLE_DRIFT : -IDLE_DRIFT;

  return (
    <motion.div
      style={{
        left: `${crop.left}%`,
        top: `${crop.top}%`,
        width: crop.size,
        height: crop.size,
      }}
      initial={{
        opacity: 0,
        scale: CROP_SCALE,
        x: cropDrift(crop.top),
        filter: "blur(10px)",
      }}
      animate={{ opacity: 1, scale: 1, x: 0, filter: "blur(0px)" }}
      transition={{ duration: CROP_TRAVEL, ease: EASE, delay }}
      className={`absolute ${crop.className}`}
    >
      <motion.div
        className="h-full w-full"
        animate={{ y: [0, -IDLE_RISE, 0], x: [0, idleDrift, 0] }}
        transition={{
          duration: idleDuration,
          delay: delay + CROP_TRAVEL,
          repeat: Infinity,
          repeatType: "loop",
          ease: "easeInOut",
        }}
      >
        <Image src={crop.src} alt="" fill sizes="230px" className="object-cover" />
      </motion.div>
    </motion.div>
  );
}

const menuLinks = [
  { label: "About", href: "/about" },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Changelog", href: "/changelog" },
  { label: "Cookies", href: "/cookies" },
] as const;

const MAIL = "sheffield@180dc.org";

/**
 * Icons are inline paths rather than an icon package — three glyphs is not
 * worth a dependency, and it keeps the sheet free of external requests. The
 * Linktree URL is stored bare: the shared link carried utm_* and fbclid
 * parameters from an Instagram bio click, which have no business being
 * hard-coded into our own site.
 */
const socials = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/180dcsheffield/",
    // Rendered from a sprite sheet rather than an <svg>; see .icon-sprite.
    sprite: "ig-sprite",
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/180dcsheffield/",
    sprite: "li-sprite",
  },
  {
    label: "Linktree",
    href: "https://linktr.ee/180dcsheffield",
    sprite: "lt-sprite",
  },
  {
    label: `Email ${MAIL}`,
    href: `mailto:${MAIL}`,
    sprite: "mail-sprite",
  },
] as const;

/**
 * The sheet opens as a circle under the burger and swells until it engulfs the
 * screen. The origin is a rough average of where the button lands across
 * breakpoints; 150% is enough radius to clear the far corner.
 */
const SHEET_ORIGIN = "95% 5%";

/**
 * Deliberately not `EASE`: that curve is front-loaded and blows the circle past
 * full radius within ~120ms, so the reveal never reads as a circle. This one
 * eases in, holding the small disc under the burger long enough to see.
 */
const SHEET_EASE = [0.76, 0, 0.24, 1] as const;

const sheet: Variants = {
  hidden: { clipPath: `circle(0% at ${SHEET_ORIGIN})` },
  show: {
    clipPath: `circle(150% at ${SHEET_ORIGIN})`,
    transition: { duration: 0.85, ease: SHEET_EASE, staggerChildren: 0.06, delayChildren: 0.45 },
  },
  exit: {
    clipPath: `circle(0% at ${SHEET_ORIGIN})`,
    transition: { duration: 0.6, ease: SHEET_EASE, staggerChildren: 0.04 },
  },
};

const sheetItem: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
  exit: { opacity: 0, y: 12, transition: { duration: 0.2, ease: EASE } },
};

/**
 * Hover on the CTA runs as a chain, not one simultaneous change:
 *   1. the green disc swells to swallow its own dark ring,
 *   2. only then does green wash leftward across the label capsule,
 *   3. the arrow darts out and back while that wash travels.
 * The delays below encode that ordering; each stage starts as the previous
 * one lands. Leaving hover reverses everything at once, quickly.
 */
const CTA_FILL = 0.22;
const CTA_WASH = 0.38;

/** Shared so the two capsules' greens and darks cannot drift apart. */
const CTA_GREEN = "#e6f5c0";

/**
 * Rest state of the CTA is glass rather than solid: the same charcoal at 72%,
 * which is the lowest opacity that still keeps the cream label above 4.5:1
 * against the page. Hover washes to opaque green, so the translucency only
 * ever shows on the dark half.
 */
const CTA_GLASS = "rgba(28, 26, 24, 0.72)";

/**
 * The lit top edge that sells glass: a one-pixel inset highlight, the way a
 * pane catches light on its upper rim. Kept on through hover so the capsule
 * and the disc do not lose their edge at different moments.
 */
const CTA_LIP = "inset 0 1px 0 rgba(255, 255, 255, 0.3)";

/**
 * Both capsules paint dark and green as a *single* background on one element,
 * never as two stacked children. Stacked children are each antialiased against
 * the rounded clip independently, so an edge pixel of coverage α composites to
 * page(1-α)² + α(1-α)·dark + α·green — that middle term is a dark hairline that
 * no amount of overshoot removes. One layer means one antialiased edge.
 *
 * Circle: permanently green, with the dark ring drawn as an *inset shadow* that
 * shrinks to nothing. A gradient animated on this element left a faint seam at
 * the rounded edge once Chrome promoted it to its own layer; an inset shadow is
 * rasterised together with the background, so the element has exactly one
 * antialiased edge and nothing can peek out from under it.
 */
const ctaDisc: Variants = {
  rest: {
    boxShadow: `inset 0 0 0 3px ${CTA_GLASS}, ${CTA_LIP}`,
    transition: { duration: 0.25, ease: EASE },
  },
  hover: {
    boxShadow: `inset 0 0 0 0px ${CTA_GLASS}, ${CTA_LIP}`,
    transition: { duration: CTA_FILL, ease: EASE },
  },
};

/**
 * The fill's leading edge is the pill's own end-cap, reused rather than
 * redrawn: a `rounded-l-full` block at the pill's full height caps its radius
 * at height/2 exactly like `rounded-full` does on the pill itself, so the two
 * curves are guaranteed identical — same mechanism, same 20px radius. Sliding
 * it on `left` (a percentage, so it reads off the pill's own width as
 * containing block) walks that cap across like a second pill sweeping through
 * the first, entering from the circle's side. Breaks the single-paint-layer
 * rule the pill used to hold (see ctaDisc above) — a rounded leading edge
 * isn't expressible as one background, so this is a second layer under the
 * label instead.
 */
const ctaWash: Variants = {
  rest: { left: "100%", transition: { duration: 0.28, ease: EASE } },
  hover: {
    left: "0%",
    transition: { duration: CTA_WASH, ease: EASE, delay: CTA_FILL },
  },
};

const ctaLabel: Variants = {
  rest: { color: "#f4f4ef", transition: { duration: 0.2 } },
  // Flips once the wash is far enough left to be under the text.
  hover: { color: "#0c1014", transition: { duration: 0.18, delay: CTA_FILL + 0.1 } },
};

/**
 * The arrow exits stage right, then re-enters from the left — the jump between
 * the two is instantaneous and happens while it is outside the disc, which
 * clips it, so the eye reads one arrow travelling through rather than two.
 * 26px clears half the disc plus half the icon.
 */
const ctaArrow: Variants = {
  rest: { x: 0, transition: { duration: 0.25, ease: EASE } },
  hover: {
    x: [0, 26, -26, 0],
    transition: {
      duration: 0.7,
      delay: CTA_FILL,
      times: [0, 0.45, 0.4501, 1],
      ease: EASE,
    },
  },
};

/**
 * The sheet's copy of the CTA runs the identical hover chain — disc swallows its
 * ring, wash sweeps left, arrow darts — with white standing in everywhere the
 * hero uses green. Only the disc needs its own variants: the ring is drawn in
 * the sheet's own ink rather than the glass charcoal, so it reads as the sheet
 * showing through a gap around the white disc instead of as a painted ring.
 * `ctaWash`, `ctaLabel`, and `ctaArrow` are reused untouched — the wash animates
 * `left` only, and the label already flips cream to ink.
 */
const SHEET_INK = "#0c1014";

const sheetCtaDisc: Variants = {
  rest: {
    boxShadow: `inset 0 0 0 3px ${SHEET_INK}, ${CTA_LIP}`,
    transition: { duration: 0.25, ease: EASE },
  },
  hover: {
    boxShadow: `inset 0 0 0 0px ${SHEET_INK}, ${CTA_LIP}`,
    transition: { duration: CTA_FILL, ease: EASE },
  },
};

/**
 * The nav copy of the arrow dart. Same loop-through as `ctaArrow`, but it fires
 * on the hover frame instead of waiting on a fill stage the small button has no
 * equivalent of, and 22px is what clears half the 36px disc plus half the icon.
 */
const navArrow: Variants = {
  rest: { x: 0, transition: { duration: 0.25, ease: EASE } },
  hover: {
    x: [0, 22, -22, 0],
    transition: { duration: 0.6, times: [0, 0.45, 0.4501, 1], ease: EASE },
  },
};

/**
 * Hand-drawn tree used as the menu sheet's corner motif. The source PNG is
 * white line-art on a transparent ground, so it needs no keying — opacity
 * alone gives it the low-contrast, drawn-on feel.
 */
function TreeMark() {
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

/**
 * Brand marks set inline in the headline, standing in for the three tools the
 * product replaces. Sized in `em` so they track the headline's `clamp()` type
 * scale, and nudged up a hair because a glyph's optical centre sits above the
 * box centre `align-middle` lands on.
 *
 * Sheets and Gmail are the single-path Simple Icons marks, tinted to each
 * brand's own colour rather than `currentColor`. monday.com isn't in that set;
 * its paths come from public/monday-seeklogo.svg, kept as the provenance copy.
 *
 * All three are inlined rather than fetched as <Image src="…svg">, matching the
 * social icons above: no extra request, and the mark inherits the headline's
 * `em` sizing directly.
 */
const INLINE_MARK =
  "inline-block h-[0.78em] w-[0.78em] -translate-y-[0.06em] align-middle";

function SheetsMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="#0F9D58"
      className={INLINE_MARK}
      role="img"
      aria-label="Google Sheets"
    >
      <path d="M11.318 12.545H7.91v-1.909h3.41v1.91zM14.728 0v6h6l-6-6zm1.363 10.636h-3.41v1.91h3.41v-1.91zm0 3.273h-3.41v1.91h3.41v-1.91zM20.727 6.5v15.864c0 .904-.732 1.636-1.636 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.318v6.5h6.5zm-3.273 2.773H6.545v7.909h10.91v-7.91zm-6.136 4.636H7.91v1.91h3.41v-1.91z" />
    </svg>
  );
}

function GmailMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="#EA4335"
      className={INLINE_MARK}
      role="img"
      aria-label="Gmail"
    >
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
    </svg>
  );
}

/**
 * The only mark that isn't square: its artwork is 256×156, so height and width
 * are set separately to keep the ratio. The height is the *glyph* height of the
 * other two (their 24-unit box carries some padding), so all three sit at the
 * same optical size on the line.
 */
function MondayMark() {
  return (
    <svg
      viewBox="0 0 256 156"
      className="inline-block h-[0.6em] w-[0.985em] -translate-y-[0.06em] align-middle"
      role="img"
      aria-label="monday.com"
    >
      <path
        fill="#F62B54"
        d="M31.8458633,153.488694 C20.3244423,153.513586 9.68073708,147.337265 3.98575204,137.321731 C-1.62714067,127.367831 -1.29055839,115.129325 4.86093879,105.498969 L62.2342919,15.4033556 C68.2125882,5.54538256 79.032489,-0.333585033 90.5563073,0.0146553508 C102.071737,0.290611552 112.546041,6.74705604 117.96667,16.9106216 C123.315033,27.0238906 122.646488,39.1914174 116.240607,48.6847625 L58.9037201,138.780375 C52.9943022,147.988884 42.7873202,153.537154 31.8458633,153.488694 Z"
      />
      <path
        fill="#FFCC00"
        d="M130.25575,153.488484 C118.683837,153.488484 108.035731,147.301291 102.444261,137.358197 C96.8438154,127.431292 97.1804475,115.223704 103.319447,105.620522 L160.583402,15.7315506 C166.47539,5.73210989 177.327374,-0.284878136 188.929728,0.0146553508 C200.598885,0.269918151 211.174058,6.7973526 216.522421,17.0078646 C221.834319,27.2183766 221.056375,39.4588356 214.456008,48.9278699 L157.204209,138.816842 C151.313487,147.985468 141.153618,153.5168 130.25575,153.488484 Z"
      />
      <ellipse fill="#00CA72" cx="226.47" cy="125.32" rx="29.54" ry="28.92" />
    </svg>
  );
}

/**
 * `scroll` mode renders the wordmark at a size driven entirely by the
 * inherited `--t` CSS variable (1 = full splash size, 0 = resting nav size):
 * every dimension is a `calc()` mixing the two endpoints, so native CSS
 * re-evaluates it on every scroll frame with zero React re-renders. Without
 * `scroll`, it's just the fixed small wordmark (used inside the menu sheet,
 * which never scales with the page).
 */
function Wordmark({ tone, scroll }: { tone: "light" | "dark"; scroll?: boolean }) {
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
          stencilled from its own alpha, so it swaps in cleanly on the dark
          menu sheet where the green reads muddy.
          `scroll` mode sizes via `fill` on a calc()'d wrapper instead of
          width/height props: two independently-rounded identical `calc()`
          expressions can land a sub-pixel apart, and Next's Image warns about
          "aspect ratio changed" whenever the rendered box doesn't exactly
          match the width/height attributes — fill sidesteps that check.
          The min-h/min-w floor is the settled size, so it's a no-op visually
          but keeps the box from collapsing to 0 (and the image with it) in the
          frame before `--t` resolves. */}
      {scroll ? (
        <div className="relative h-[calc(clamp(2.6rem,12.6vw,13rem)*var(--t,1)+2.25rem*(1_-_var(--t,1)))] min-h-9 w-[calc(clamp(2.6rem,12.6vw,13rem)*var(--t,1)+2.25rem*(1_-_var(--t,1)))] min-w-9 shrink-0 min-[1700px]:h-[calc(14.5rem*var(--t,1)+2.25rem*(1_-_var(--t,1)))] min-[1700px]:w-[calc(14.5rem*var(--t,1)+2.25rem*(1_-_var(--t,1)))]">
          <Image
            src={tone === "light" ? "/180dc-globe-white.png" : "/180dc-globe.png"}
            alt=""
            fill
            sizes="280px"
            className="object-contain"
          />
        </div>
      ) : (
        <Image
          src={tone === "light" ? "/180dc-globe-white.png" : "/180dc-globe.png"}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 object-contain"
        />
      )}
      180Connect
    </div>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  // Escape closes the sheet — the burger is the only other way out, and it can
  // scroll out of reach on short viewports.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // 1 = full splash (big, centred low), 0 = settled into the nav corner.
  // CTA, leaf crops, and burger blur in a little before the shrink finishes.
  // Everything below reads off these two motion values via `calc()`, same as
  // the scroll-driven version — only the source (a timer, not scroll) changed.
  const introT = useMotionValue(1);
  const revealT = useMotionValue(0);

  useEffect(() => {
    const shrink = animate(introT, 0, { duration: 2.2, ease: EASE, delay: 1.8 });
    const reveal = animate(revealT, 1, { duration: 0.8, ease: EASE, delay: 2.9 });
    return () => {
      shrink.stop();
      reveal.stop();
    };
  }, [introT, revealT]);

  const revealY = useTransform(revealT, [0, 1], [14, 0]);
  const revealBlur = useTransform(revealT, [0, 1], [10, 0]);
  const revealFilter = useMotionTemplate`blur(${revealBlur}px)`;

  return (
    // "user" honours prefers-reduced-motion: transforms are dropped, opacity
    // fades survive, so the page still resolves rather than snapping in.
    <MotionConfig reducedMotion="user">
      <motion.main
        className="relative flex flex-1 flex-col overflow-hidden bg-[#f4f4ef]"
        style={{ "--t": introT } as React.CSSProperties}
      >
        {/* The scatter can only start below the CTA, which on a wide desktop
            leaves the whole band beside the headline empty — this layer fills
            it. Anchored to the viewport rather than to the scatter's box, and
            behind the copy (which carries z-10) so a crop can pass under the
            text without ever competing with it. Positions stay in the margins
            regardless, well clear of the headline's measure. */}
        <div
          className="pointer-events-none absolute inset-0 z-0 hidden min-[1800px]:block"
          aria-hidden="true"
        >
          {squares.map((sq, i) =>
            sq.hero ? <Crop key={i} crop={sq} delay={cropDelays[i]} index={i} /> : null,
          )}
        </div>

        {/* Sits *below* the sheet: the light twin inside the sheet is revealed
            by the same circle that paints the ink, so the swap is exact by
            construction instead of a delay guessing when the edge arrives. */}
        <motion.div
          className="absolute top-0 left-0 z-30 translate-x-[calc(2.5rem*var(--t,1))] px-6 py-6 sm:px-10 sm:py-8"
          initial={{ opacity: 0, filter: "blur(8px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.4 }}
        >
          <Wordmark tone="dark" scroll />
        </motion.div>

          {/* Nav twin of the hero CTA, parked to the left of the burger. Offsets
              are the burger's own gutter plus its 44px box plus a gap, so the
              two sit on one line however the gutter changes at sm — and the
              sheet's own copy of this button reuses the same three offsets, so
              the two land in exactly the same place.

              z-30 keeps it *under* the sheet rather than above it like the
              burger: the opening circle paints straight over it and the sheet's
              white twin takes the slot, which is the same wipe-not-fade swap the
              wordmark does, with no state of its own to animate. */}
          <MotionLink
            href="/login"
            aria-label="Get started"
            className="absolute top-0 right-[68px] z-30 mt-6 flex h-11 items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0c1014] sm:right-[86px] sm:mt-8"
            style={{ opacity: revealT, y: revealY, filter: revealFilter }}
            initial="rest"
            animate="rest"
            whileHover="hover"
            whileTap={{ scale: 0.96 }}
          >
            <span
              className="relative flex h-9 items-center overflow-hidden rounded-full ring-1 ring-white/25 backdrop-blur-md"
              style={{ backgroundColor: CTA_GLASS, boxShadow: CTA_LIP }}
            >
              <span className="whitespace-nowrap px-4 font-body text-xs font-medium text-[#f4f4ef] sm:px-5 sm:text-sm">
                Get Started
              </span>
            </span>

            <span
              className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#e6f5c0] text-[#0c1014]"
              style={{ boxShadow: `inset 0 0 0 3px ${CTA_GLASS}, ${CTA_LIP}` }}
            >
              <motion.span variants={navArrow} className="flex">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-[15px] w-[15px]"
                  aria-hidden="true"
                >
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </motion.span>
            </span>
          </MotionLink>

          {/* Three lines that fold into an X: the outer bars meet in the middle
              and cross, the middle bar drops out underneath them. Kept above the
              sheet so it stays clickable once the menu is open. */}
          <motion.button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="absolute top-0 right-0 z-50 mt-6 mr-4 flex h-11 w-11 items-center justify-center sm:mt-8 sm:mr-8"
            style={{ opacity: revealT, y: revealY, filter: revealFilter }}
          >
            <span className="relative block h-[14px] w-7">
              {[0, 1, 2].map((line) => (
                <motion.span
                  key={line}
                  className="absolute left-0 block h-[2px] w-full rounded-full"
                  style={{ top: line * 6 }}
                  animate={{
                    y: menuOpen ? (line === 0 ? 6 : line === 2 ? -6 : 0) : 0,
                    rotate: menuOpen ? (line === 0 ? 45 : line === 2 ? -45 : 0) : 0,
                    opacity: menuOpen && line === 1 ? 0 : 1,
                    // The burger sits at the circle's origin, so the sheet reaches
                    // it immediately — no delay needed here.
                    backgroundColor: menuOpen ? "#f4f4ef" : "#0c1014",
                  }}
                  transition={{ duration: 0.35, ease: EASE }}
                />
              ))}
            </span>
          </motion.button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                variants={sheet}
                initial="hidden"
                animate="show"
                exit="exit"
                className="fixed inset-0 z-40 flex flex-col justify-center bg-[#0c1014] px-6 sm:px-10"
              >
                {/* Same position as the dark one underneath, so the circle wipes
                    one into the other with no cross-fade. */}
                <div className="absolute top-0 left-0 px-6 py-6 sm:px-10 sm:py-8">
                  <Wordmark tone="light" />
                </div>

                {/* Oversized and pushed past the corner so it reads as a crop of
                    something larger rather than a placed icon. */}
                <motion.div
                  variants={sheetItem}
                  // Box follows the artwork's portrait ratio, and bleeds off the
                  // right edge only — pushing it down as well would cut the roots.
                  className="pointer-events-none absolute right-0 bottom-0 h-[min(88vh,760px)] w-[min(71vh,613px)] translate-x-[10%] translate-y-[4%] opacity-25"
                  aria-hidden="true"
                >
                  <TreeMark />
                </motion.div>

                <nav className="flex flex-col gap-2 sm:gap-4">
                  {menuLinks.map((link) => (
                    <motion.div key={link.label} variants={sheetItem}>
                      <Link
                        href={link.href}
                        onClick={() => setMenuOpen(false)}
                        className="font-body text-[clamp(2.5rem,8vw,5.5rem)] font-black leading-[1.05] tracking-[-0.03em] text-[#f4f4ef] transition-opacity hover:opacity-50"
                      >
                        {link.label}
                      </Link>
                    </motion.div>
                  ))}
                </nav>

                {/* Same two-capsule CTA as the hero, white where that one is
                    green, sized and placed to land exactly on the dark nav
                    button underneath — same three offsets, same 36px halves —
                    so opening the sheet reads as that button turning white
                    rather than one button leaving and another arriving.
                    Unlike the other sheet children, this wrapper carries no
                    sheetItem entrance: it must already be sitting in its final
                    place, unanimated, before the circle even starts opening,
                    so the clip-path reveal is the only thing that makes it
                    appear — the same button caught mid-recolour, not a new
                    element flying in on its own delay. */}
                <div className="absolute top-0 right-[68px] mt-6 flex h-11 items-center sm:right-[86px] sm:mt-8">
                  <MotionLink
                    href="/login"
                    onClick={() => setMenuOpen(false)}
                    className="inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f4f4ef]"
                    initial="rest"
                    animate="rest"
                    whileHover="hover"
                    whileTap={{ scale: 0.97 }}
                    variants={{ rest: { y: 0 }, hover: { y: -2 } }}
                    transition={{ type: "spring", stiffness: 420, damping: 28 }}
                  >
                    {/* No backdrop-blur on this twin, unlike the hero's: the
                        sheet is flat ink, so there is nothing behind the pill
                        for a blur to pick up, and the hero's glass charcoal is
                        near-invisible against it. A faint white tint keeps the
                        capsule readable at rest and gives the wash something to
                        travel over. */}
                    <motion.span
                      className="relative flex h-9 items-center overflow-hidden rounded-full px-4 ring-1 ring-white/25 sm:px-5"
                      style={{
                        backgroundColor: "rgba(244, 244, 239, 0.08)",
                        boxShadow: CTA_LIP,
                      }}
                    >
                      <motion.div
                        variants={ctaWash}
                        className="absolute inset-y-0 w-[999px] rounded-l-full"
                        style={{ backgroundColor: "#f4f4ef" }}
                        aria-hidden="true"
                      />
                      <motion.span
                        variants={ctaLabel}
                        className="relative z-10 whitespace-nowrap font-body text-xs font-medium sm:text-sm"
                      >
                        Get Started
                      </motion.span>
                    </motion.span>
                    <motion.span
                      variants={sheetCtaDisc}
                      className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-[#0c1014]"
                      style={{ backgroundColor: "#f4f4ef" }}
                    >
                      {/* navArrow, not ctaArrow: 22px is what a 36px disc needs,
                          and the dart fires on the hover frame — the hero's
                          delay sequences it behind a fill stage this pair still
                          has, but at nav scale the wait reads as lag. */}
                      <motion.span variants={navArrow} className="flex">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-[15px] w-[15px]"
                          aria-hidden="true"
                        >
                          <path d="M5 12h14" />
                          <path d="m13 6 6 6-6 6" />
                        </svg>
                      </motion.span>
                    </motion.span>
                  </MotionLink>
                </div>

                {/* Sits above the tree, which is decorative and pointer-events
                    none, so these stay clickable where the two overlap. */}
                <motion.div
                  variants={sheetItem}
                  className="absolute right-0 bottom-0 left-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 px-6 pb-6 sm:px-10 sm:pb-8"
                >
                  <div className="flex items-center gap-5">
                    {socials.map((social) => (
                      <a
                        key={social.label}
                        href={social.href}
                        // mailto: hands off to a mail client, so a new tab would
                        // just leave a blank one behind.
                        target={social.href.startsWith("http") ? "_blank" : undefined}
                        rel={social.href.startsWith("http") ? "noopener noreferrer" : undefined}
                        aria-label={social.label}
                        className="text-[#f4f4ef]/60 transition-colors hover:text-[#f4f4ef]"
                      >
                        {/* Frame 0 until hovered, then the sprite steps through
                            its frames — see .icon-sprite in globals.css. Linktree
                            is a single-frame sheet, so it simply sits still. */}
                        <span
                          className={`icon-sprite ${social.sprite} block opacity-60 transition-opacity hover:opacity-100`}
                          aria-hidden="true"
                        />
                      </a>
                    ))}
                  </div>

                  {/* mx-auto centres it in what's left of the row after the
                      icons, which lands it in the gap before the tree rather
                      than under it; the translate biases it back towards the
                      icons. Translating rather than changing the margins keeps
                      the centring maths intact at every width. */}
                  <p className="font-body text-xs tracking-[0.02em] text-[#f4f4ef]/40 sm:mx-auto sm:-translate-x-40">
                    © {new Date().getFullYear()} 180 Degrees Consulting Sheffield
                  </p>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            // The wordmark and burger are absolute now, so this pad stands in for
            // the height they used to occupy in flow.
            className="relative z-10 flex flex-1 flex-col px-6 pt-[76px] sm:px-10 sm:pt-[92px]"
            variants={stack}
            initial="hidden"
            animate="show"
          >
            <div
              className="flex flex-col items-center gap-6 text-center"
              style={{
                paddingTop:
                  "calc(54vh * var(--t, 1) + 8rem * (1 - var(--t, 1)))",
              }}
            >
              <motion.h1
                variants={item}
                className="font-body text-[clamp(2.25rem,6vw,4.5rem)] font-black leading-[1.05] tracking-[-0.03em] text-[#1c1a18]"
              >
                Replace <SheetsMark /> spreadsheets, <GmailMark /> follow-ups
                <br />
                 and <MondayMark /> tracking. All in one place.
              </motion.h1>

              {/* <motion.p
                variants={item}
                className="max-w-[42rem] font-mono text-sm leading-relaxed text-[#0c1014]/55"
              >
                180Connect replaces the sheets, inboxes, and trackers you&apos;re
                stitching together today with one platform for outreach,
                follow-ups, and reporting.
              </motion.p> */}
            </div>

            {/* z-10 makes this a stacking context, which is what lets the leaf
                below sit behind the button while still covering the page. */}
            <motion.div
              style={{ opacity: revealT, y: revealY, filter: revealFilter }}
              className="relative z-10 flex justify-center pt-8 sm:pt-10"
            >
              {/* A crop pulled up out of the scatter below and parked under the
                  CTA, so the capsule's backdrop-blur has something to blur.
                  Anchored to this wrapper rather than positioned in the scatter
                  grid, so it tracks the button at every width. */}
              <div
                // Sized and placed to clear the paragraph above it: below lg the
                // copy runs full width, and a taller crop reached up into it.
                className="pointer-events-none absolute top-0 -left-12 -z-10 h-[160px] w-[160px]"
                aria-hidden="true"
              >
                <Image
                  src="/crops/leaf-vine.png"
                  alt=""
                  fill
                  sizes="190px"
                  className="object-cover"
                />
              </div>

              {/* Two capsules meeting at a tangent, not one merged shape: they
                  touch at a single point, leaving the lens slivers above and
                  below that give the look its bite. */}
              <MotionLink
                href="/login"
                className="inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0c1014]"
                initial="rest"
                animate="rest"
                whileHover="hover"
                whileTap={{ scale: 0.97 }}
                variants={{ rest: { y: 0 }, hover: { y: -2 } }}
                transition={{ type: "spring", stiffness: 420, damping: 28 }}
              >
                {/* Both halves share the height so the circle stays a circle and
                    the two keep meeting at a single tangent point. */}
                <motion.span
                  // backdrop-blur bites on the leaf behind; the ring and the lit
                  // top edge keep the glass legible where it overhangs the flat
                  // page, which the blur alone cannot do. overflow-hidden clips
                  // the oversized wash block to the pill's rounded shape.
                  className="relative flex h-10 items-center overflow-hidden rounded-full px-6 ring-1 ring-white/25 backdrop-blur-md"
                  style={{ backgroundColor: CTA_GLASS, boxShadow: CTA_LIP }}
                >
                  {/* Wide enough that its square trailing edge never enters
                      frame — only the rounded leading edge is ever on screen. */}
                  <motion.div
                    variants={ctaWash}
                    className="absolute inset-y-0 w-[999px] rounded-l-full"
                    style={{ backgroundColor: CTA_GREEN }}
                    aria-hidden="true"
                  />
                  <motion.span
                    variants={ctaLabel}
                    className="relative z-10 font-body text-sm font-medium"
                  >
                    Get Started
                  </motion.span>
                </motion.span>
                {/* Green disc inset inside the dark circle, so the dark reads as a
                    ring around it rather than the whole token going green. */}
                <motion.span
                  variants={ctaDisc}
                  // overflow-hidden is what sells the arrow's loop-through: it
                  // vanishes at the rim instead of drifting outside the circle.
                  className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-[#0c1014]"
                  style={{ backgroundColor: CTA_GREEN }}
                >
                  <motion.span variants={ctaArrow} className="flex">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-[16px] w-[16px]"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14" />
                      <path d="m13 6 6 6-6 6" />
                    </svg>
                  </motion.span>
                </motion.span>
              </MotionLink>
            </motion.div>

            {/* Scattered crops of the same source photo — a few left soft to
                read as depth-of-field rather than a gallery grid. */}
            <div className="relative mt-10 h-[360px] flex-1 sm:h-[460px] lg:h-[520px]">
              {squares.map((sq, i) =>
                sq.hero ? null : <Crop key={i} crop={sq} delay={cropDelays[i]} index={i} />,
              )}
            </div>
          </motion.div>
      </motion.main>
    </MotionConfig>
  );
}
