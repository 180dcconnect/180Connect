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
        <motion.div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-fit max-w-4xl h-14 bg-black z-50 rounded-b-[1.25rem] flex items-center justify-between gap-8 sm:gap-14 px-7 sm:px-10 text-white shadow-xl"
          initial={{ y: "-100%" }}
          animate={{ y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
        >
          {/* Left inverted corner */}
          <div className="absolute top-0 -left-4 w-4 h-4 bg-transparent rounded-tr-xl shadow-[8px_-8px_0_8px_black]" />
          {/* Right inverted corner */}
          <div className="absolute top-0 -right-4 w-4 h-4 bg-transparent rounded-tl-xl shadow-[-8px_-8px_0_8px_black]" />
          
          <div className="flex items-center gap-2 font-bold text-sm sm:text-base shrink-0">
            <div className="w-5 h-5 rounded-[0.3rem] bg-gradient-to-b from-[#4facfe] to-[#00f2fe] shadow-sm" />
            180Connect
          </div>
          
          <div className="hidden md:flex items-center gap-6 lg:gap-8 text-xs font-medium text-white/60">
            <span className="hover:text-white cursor-pointer transition-colors">Privacy</span>
            <span className="hover:text-white cursor-pointer transition-colors">Terms</span>
            <span className="hover:text-white cursor-pointer transition-colors">Cookies</span>
          </div>
          
          <Link href="/login" className="bg-white text-black px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 hover:scale-105 transition-transform shrink-0">
            Sign in
          </Link>
        </motion.div>

        {/* Already treated in the source file — served as-is, no canvas pass.
            The slow settle from 1.06 is the only motion applied to it. */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0"
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
         {/* <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[82%] bg-gradient-to-b from-background via-background/92 to-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, ease: EASE }}
        />  */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-[#0c1014]/90 via-[#0c1014]/45 to-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, ease: EASE }}
        />

        <motion.div
          className="relative z-10 flex flex-1 flex-col px-6 py-6 sm:px-10 sm:py-8"
          variants={stack}
          initial="hidden"
          animate="show"
        >

          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="max-w-[60rem]">
              <motion.h1
                variants={item}
                className="font-body text-[clamp(1.75rem,3.75vw,3.25rem)] font-black leading-[1.2] tracking-[-0.035em] text-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-4"
              >
                <span>Replace</span>
                
                <span className="inline-flex items-center gap-3">
                  <span className="flex items-center justify-center rounded-2xl bg-white p-2.5 ring-1 ring-black/10 shadow-sm dark:bg-white/10 dark:ring-white/20">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/3/30/Google_Sheets_logo_%282014-2020%29.svg" alt="Google Sheets" className="h-[0.9em] w-[0.9em] object-contain" />
                  </span>
                  <span>spreadsheets,</span>
                </span>

                <span className="inline-flex items-center gap-3">
                  <span className="flex items-center justify-center rounded-2xl bg-white p-2.5 ring-1 ring-black/10 shadow-sm dark:bg-white/10 dark:ring-white/20">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg" alt="Gmail" className="h-[0.9em] w-[0.9em] object-contain" />
                  </span>
                  <span>follow-ups</span>
                </span>
                
                <span>and</span>
                
                <span className="inline-flex items-center gap-3">
                  <span className="flex items-center justify-center rounded-2xl bg-white p-2.5 ring-1 ring-black/10 shadow-sm dark:bg-white/10 dark:ring-white/20">
                    <img src="https://www.vectorlogo.zone/logos/monday/monday-icon.svg" alt="monday.com" className="h-[0.9em] w-[0.9em] object-contain" />
                  </span>
                  <span>tracking.</span>
                </span>
                
                <span className="inline-flex items-center gap-3">
                  <span>All in one platform</span>
                  <img src="https://framerusercontent.com/images/lpSL1f275shJ97WvsBBHaO4zSGI.png?scale-down-to=1024&width=1385&height=1432" alt="180Connect Platform" className="h-[1.2em] w-auto object-contain" />
                </span>
              </motion.h1>

              <motion.div
                variants={item}
                className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
              >
                <MotionLink
                  href="/login"
                  className="inline-flex h-11 items-center rounded-2xl bg-gradient-to-br from-[#8ed85d] via-brand to-[#4b8427] px-8 text-sm font-bold text-white shadow-[inset_1.5px_1.5px_2px_rgba(255,255,255,0.5),inset_-2.5px_-2.5px_5px_rgba(0,0,0,0.4),0_4px_12px_rgba(0,0,0,0.2)] ring-1 ring-black/15 transition-all hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
