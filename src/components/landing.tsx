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
 * for the photo to have started resolving underneath.
 */
const stack: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.09, delayChildren: 0.15 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

export default function Landing() {
  return (
    // "user" honours prefers-reduced-motion: transforms are dropped, opacity
    // fades survive, so the page still resolves rather than snapping in.
    <MotionConfig reducedMotion="user">
      <main className="relative flex flex-1 flex-col overflow-hidden bg-background">
        {/* Already treated in the source file — served as-is, no canvas pass.
            The slow settle from 1.06 is the only motion applied to it. */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.6, ease: EASE }}
        >
          <Image
            src="/forest2.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-top"
          />
        </motion.div>

        {/* Scrims track the photo's own tonality: paper at the top where the
            type is dark, forest shadow at the foot where it turns light. */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[82%] bg-gradient-to-b from-background via-background/92 to-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, ease: EASE }}
        />
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-[#0c1014]/90 via-[#0c1014]/45 to-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, ease: EASE }}
        />

        <motion.div
          className="relative flex flex-1 flex-col px-6 py-6 sm:px-10 sm:py-8"
          variants={stack}
          initial="hidden"
          animate="show"
        >
          <motion.header
            variants={item}
            className="flex items-baseline font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-foreground/60"
          >
            <span className="font-semibold text-foreground">
              180<span className="text-brand">Connect</span>
            </span>
          </motion.header>

          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="max-w-[52rem]">
              <motion.h1
                variants={item}
                className="font-body text-[clamp(2.5rem,7.5vw,5.25rem)] font-black leading-[0.94] tracking-[-0.035em] text-foreground"
              >
                Find the organisations
                <br />
                worth contacting first.
              </motion.h1>

              <motion.p
                variants={item}
                className="mx-auto mt-7 max-w-[44ch] text-base leading-relaxed text-foreground/90 sm:text-lg"
              >
                One record per organisation — scored, owned and searchable — instead of
                spreadsheets, shared inboxes and Drive folders.
              </motion.p>

              <motion.div
                variants={item}
                className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
              >
                <MotionLink
                  href="/login"
                  className="inline-flex h-11 items-center rounded-full bg-brand px-7 text-sm font-bold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 420, damping: 28 }}
                >
                  Log in
                </MotionLink>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </main>
    </MotionConfig>
  );
}
