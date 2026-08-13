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

function Wordmark({ tone }: { tone: "light" | "dark" }) {
  return (
    <div
      className={`flex items-center gap-2 font-body text-lg font-black tracking-tight ${
        tone === "light" ? "text-white" : "text-[#0c1014]"
      }`}
    >
      <div className="h-4 w-4 rounded-[0.3rem] bg-gradient-to-b from-[#4facfe] to-[#00f2fe] shadow-sm" />
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
      <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0c1014]">
        {/* Sits *below* the sheet: the dark twin inside the sheet is revealed by
            the same circle that paints the white, so the swap is exact by
            construction instead of a delay guessing when the edge arrives. */}
        <motion.div
          className="absolute top-0 left-0 z-30 px-6 py-6 sm:px-10 sm:py-8"
          initial={{ opacity: 0, y: -14, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
        >
          <Wordmark tone="light" />
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
                  // The burger sits at the circle's origin, so white reaches it
                  // immediately — no delay needed here.
                  backgroundColor: menuOpen ? "#0c1014" : "#ffffff",
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
              className="fixed inset-0 z-40 flex flex-col justify-center bg-white px-6 sm:px-10"
            >
              {/* Same position as the light one underneath, so the circle wipes
                  one into the other with no cross-fade. */}
              <div className="absolute top-0 left-0 px-6 py-6 sm:px-10 sm:py-8">
                <Wordmark tone="dark" />
              </div>

              <nav className="flex flex-col gap-2 sm:gap-4">
                {menuLinks.map((link) => (
                  <motion.div key={link.label} variants={sheetItem}>
                    <Link
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className="font-body text-[clamp(2.5rem,8vw,5.5rem)] font-black leading-[1.05] tracking-[-0.03em] text-[#0c1014] transition-opacity hover:opacity-50"
                    >
                      {link.label}
                    </Link>
                  </motion.div>
                ))}
              </nav>

              <motion.div variants={sheetItem} className="pt-10">
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="font-mono text-xs uppercase tracking-widest text-[#0c1014]/50 transition-colors hover:text-[#0c1014]"
                >
                  [ Log in ]
                </Link>
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
              className="font-body text-[clamp(2.25rem,6vw,4.5rem)] font-black leading-[1.05] tracking-[-0.03em] text-white"
            >
              Replace spreadsheets,
              <br />
              follow-ups and tracking.
            </motion.h1>

            <motion.p
              variants={item}
              className="font-mono text-sm leading-relaxed text-white/50 lg:pt-3"
            >
              180Connect replaces the sheets, inboxes, and trackers you&apos;re
              stitching together today with one platform for outreach,
              follow-ups, and reporting.
            </motion.p>
          </div>

          <motion.div variants={item} className="pt-8 sm:pt-10">
            <MotionLink
              href="/login"
              className="inline-flex h-11 items-center rounded-2xl bg-brand px-7 text-sm font-bold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
            >
              Log in
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
