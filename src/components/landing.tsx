"use client";

import { MotionConfig, motion, type Variants } from "motion/react";
import Image from "next/image";
import Link from "next/link";

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
 * tree2.jpg with sharp) rather than an object-position trick — real
 * close-in detail instead of a shifted-but-still-wide frame.
 */
/**
 * The soft entries point at a PNG whose blur was baked in over transparent
 * padding, so the square's own edges dissolve outward — no CSS mask, and the
 * shape stays square rather than going round.
 */
const squares = [
  { left: 42, top: 7, size: 100, src: "/crops/t2-plain-bg-soft.png", className: "" },
  { left: 17, top: 19, size: 157, src: "/crops/t2-bark-right.jpg", className: "hidden sm:block" },
  { left: 60, top: 34, size: 65, src: "/crops/t2-plain-bg-soft.png", className: "hidden md:block" },
  { left: 76, top: 32, size: 135, src: "/crops/t2-vine-right.jpg", className: "" },
  { left: 30, top: 56, size: 242, src: "/crops/t2-moss-top.jpg", className: "" },
  { left: 56, top: 74, size: 178, src: "/crops/t2-fern.jpg", className: "hidden sm:block" },
] as const;

const squareItem: Variants = {
  hidden: { opacity: 0, scale: 0.85, y: 18 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.9, ease: EASE },
  },
};

export default function Landing() {
  return (
    // "user" honours prefers-reduced-motion: transforms are dropped, opacity
    // fades survive, so the page still resolves rather than snapping in.
    <MotionConfig reducedMotion="user">
      <main className="relative flex flex-1 flex-col overflow-hidden bg-[#0c1014]">
        <motion.nav
          className="relative z-20 flex items-center justify-between px-6 py-6 sm:px-10 sm:py-8"
          initial={{ opacity: 0, y: -14, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
        >
          <div className="flex items-center gap-2 font-body font-black text-lg tracking-tight text-white">
            <div className="w-4 h-4 rounded-[0.3rem] bg-gradient-to-b from-[#4facfe] to-[#00f2fe] shadow-sm" />
            180Connect
          </div>

          <div className="flex items-center gap-5 sm:gap-8 font-mono text-xs uppercase tracking-widest text-white/50">
            <span className="hidden sm:inline hover:text-white transition-colors cursor-default">[ Features ]</span>
            <span className="hidden sm:inline hover:text-white transition-colors cursor-default">[ About ]</span>
            <Link href="/login" className="hover:text-white transition-colors">
              [ Log in ]
            </Link>
          </div>
        </motion.nav>

        <motion.div
          className="relative z-10 flex flex-1 flex-col px-6 sm:px-10"
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
