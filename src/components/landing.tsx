"use client";

import { AnimatePresence, MotionConfig, motion, type Variants } from "motion/react";
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
    transition: { staggerChildren: 0.09, delayChildren: 0.15 },
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
 */
const squares = [
  { left: 42, top: 7, size: 100, src: "/crops/leaf-branch-soft.png", className: "" },
  { left: 17, top: 19, size: 157, src: "/crops/leaf-bark.png", className: "hidden sm:block" },
  { left: 60, top: 34, size: 65, src: "/crops/leaf-branch-soft.png", className: "hidden md:block" },
  { left: 76, top: 32, size: 135, src: "/crops/leaf-vine.png", className: "" },
  { left: 30, top: 56, size: 242, src: "/crops/leaf-moss.png", className: "" },
  { left: 56, top: 74, size: 178, src: "/crops/leaf-fern.png", className: "hidden sm:block" },
] as const;

const menuLinks = [
  { label: "About", href: "/about" },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
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
    transition: { duration: 0.6, ease: SHEET_EASE, when: "afterChildren", staggerChildren: 0.04 },
  },
};

const sheetItem: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
  exit: { opacity: 0, y: 12, transition: { duration: 0.2, ease: EASE } },
};

const squareItem: Variants = {
  hidden: { opacity: 0, scale: 0.85, y: 18 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.9, ease: EASE },
  },
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
const CTA_INK = "#0c1014";
const CTA_GREEN = "#e6f5c0";

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
    boxShadow: `inset 0 0 0 3px ${CTA_INK}`,
    transition: { duration: 0.25, ease: EASE },
  },
  hover: {
    boxShadow: `inset 0 0 0 0px ${CTA_INK}`,
    transition: { duration: CTA_FILL, ease: EASE },
  },
};

/**
 * Pill: a two-stop linear gradient at double width. Sliding the background from
 * one end to the other walks the hard boundary across, so green enters from the
 * circle's side — same read as the old scaleX wash, but one paint layer.
 */
const ctaWash: Variants = {
  rest: { backgroundPosition: "0% 0%", transition: { duration: 0.28, ease: EASE } },
  hover: {
    backgroundPosition: "100% 0%",
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

function Wordmark({ tone }: { tone: "light" | "dark" }) {
  return (
    <div
      className={`flex items-center gap-2 font-body text-lg font-black tracking-tight ${
        tone === "light" ? "text-white" : "text-[#0c1014]"
      }`}
    >
      {/* Globe mark only — the source lockup's wordmark is white and would
          disappear against the light page. The white variant is the same mark
          stencilled from its own alpha, so it swaps in cleanly on the dark
          menu sheet where the green reads muddy. */}
      <Image
        src={tone === "light" ? "/180dc-globe-white.png" : "/180dc-globe.png"}
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 object-contain"
      />
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

  return (
    // "user" honours prefers-reduced-motion: transforms are dropped, opacity
    // fades survive, so the page still resolves rather than snapping in.
    <MotionConfig reducedMotion="user">
      <main className="relative flex flex-1 flex-col overflow-hidden bg-[#f4f4ef]">
        {/* Sits *below* the sheet: the light twin inside the sheet is revealed
            by the same circle that paints the ink, so the swap is exact by
            construction instead of a delay guessing when the edge arrives. */}
        <motion.div
          className="absolute top-0 left-0 z-30 px-6 py-6 sm:px-10 sm:py-8"
          initial={{ opacity: 0, y: -14, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
        >
          <Wordmark tone="dark" />
        </motion.div>

        {/* Three lines that fold into an X: the outer bars meet in the middle
            and cross, the middle bar drops out underneath them. Kept above the
            sheet so it stays clickable once the menu is open. */}
        <motion.button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="absolute top-0 right-0 z-50 mt-6 mr-4 flex h-11 w-11 items-center justify-center sm:mt-8 sm:mr-8"
          initial={{ opacity: 0, y: -14, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
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
          <div className="grid grid-cols-1 gap-6 pt-6 sm:pt-10 lg:grid-cols-[1fr_18rem] lg:gap-10">
            <motion.h1
              variants={item}
              className="font-body text-[clamp(2.25rem,6vw,4.5rem)] font-black leading-[1.05] tracking-[-0.03em] text-[#0c1014]"
            >
              Replace spreadsheets,
              <br />
              follow-ups and tracking.
            </motion.h1>

            <motion.p
              variants={item}
              className="font-mono text-sm leading-relaxed text-[#0c1014]/55 lg:pt-3"
            >
              180Connect replaces the sheets, inboxes, and trackers you&apos;re
              stitching together today with one platform for outreach,
              follow-ups, and reporting.
            </motion.p>
          </div>

          <motion.div variants={item} className="pt-8 sm:pt-10">
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
                variants={ctaWash}
                className="relative flex h-10 items-center rounded-full px-6"
                style={{
                  // Hard stop at the midpoint of a double-width gradient: the
                  // visible window slides from the all-dark half to the all-green
                  // half, giving a clean vertical wipe with no second layer.
                  backgroundImage: `linear-gradient(to right, ${CTA_INK} 50%, ${CTA_GREEN} 50%)`,
                  backgroundSize: "200% 100%",
                  backgroundRepeat: "no-repeat",
                }}
              >
                <motion.span variants={ctaLabel} className="font-body text-sm font-medium">
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
            {squares.map((sq, i) => (
              <motion.div
                key={i}
                variants={squareItem}
                transition={{ duration: 0.9, ease: EASE, delay: 0.5 + i * 0.08 }}
                className={`absolute ${sq.className}`}
                style={{
                  left: `${sq.left}%`,
                  top: `${sq.top}%`,
                  width: sq.size,
                  height: sq.size,
                }}
              >
                <Image src={sq.src} alt="" fill sizes="230px" className="object-cover" />
              </motion.div>
            ))}
          </div>
        </motion.div>
      </main>
    </MotionConfig>
  );
}
