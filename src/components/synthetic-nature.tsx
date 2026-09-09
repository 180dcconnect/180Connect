"use client";

import { motion } from "motion/react";
import { Fragment, useState } from "react";

import { BrandCtaButton } from "@/components/brand/brand-cta";
import { SiteChrome } from "@/components/brand/site-chrome";
import { useAuthDialog } from "@/components/brand/use-auth-dialog";
import { Wordmark } from "@/components/brand/wordmark";
import { GROUND, INK, INK_WARM } from "@/components/brand/tokens";
import { GmailMark, MondayMark, SheetsMark } from "@/components/landing";

/**
 * Both renders are the bottom-watermark Hailuo exports, rebuilt at full
 * 2560x1440 with the watermark band replaced by a vertical mirror of the clean
 * wood above it (no crop, no zoom, no inpainting smear). The `v` query busts
 * the browser cache after each regeneration — the URL used to be cached with
 * the old watermarked/cropped bytes.
 */
const DARK_VIDEO_SRC = "/dark-mode.mp4?v=3";
const LIGHT_VIDEO_SRC = "/light-mode.mp4?v=3";

/** The cinematic dark from the original spec. */
const DARK = "#010101";

/**
 * The current landing's headline, reused verbatim — words plus the inline
 * brand marks (Sheets / Gmail / monday), imported from the landing so the
 * copy can never drift between the two pages.
 *
 * The cinematic page's per-character stagger doesn't survive this copy: ~80
 * characters at 0.07s each runs 5.6s and collides with the subtitle and CTA
 * beats. So the stagger moves to the TOKEN level — each word and mark rises
 * in reading order at 0.05s — finishing in ~1s, leaving the later beats intact.
 * Tokens are inline-block spans, so the headline wraps at word boundaries at
 * any width instead of needing the landing's hard line break.
 */
type Tok =
  | { kind: "word"; text: string }
  | { kind: "sheets" }
  | { kind: "gmail" }
  | { kind: "monday" };

const HEADLINE_TOKENS: Tok[] = [
  { kind: "word", text: "Replace" },
  { kind: "sheets" },
  { kind: "word", text: "spreadsheets," },
  { kind: "gmail" },
  { kind: "word", text: "follow-ups" },
  { kind: "word", text: "and" },
  { kind: "monday" },
  { kind: "word", text: "tracking." },
  { kind: "word", text: "All" },
  { kind: "word", text: "in" },
  { kind: "word", text: "one" },
  { kind: "word", text: "place." },
];

function Headline({ color }: { color: string }) {
  return (
    <>
      {HEADLINE_TOKENS.map((tok, i) => (
        <Fragment key={i}>
          {i > 0 ? " " : null}
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.5, ease: "easeOut" }}
            className="inline-block"
            style={tok.kind === "word" ? { color } : undefined}
          >
            {tok.kind === "word"
              ? tok.text
              : tok.kind === "sheets"
                ? <SheetsMark />
                : tok.kind === "gmail"
                  ? <GmailMark />
                  : <MondayMark />}
          </motion.span>
        </Fragment>
      ))}
    </>
  );
}

export default function SyntheticNature() {
  const [dark, setDark] = useState(false);
  // Same opener as the landing hero: pushes /login, which hosts the dialog.
  const { openSignin } = useAuthDialog();

  // Page + background colour: the landing's warm bone. The light render is
  // composited on a near-bone ground, so the page and video read as one
  // surface; if a render lands on a different ground, match LIGHT_BG to the
  // video, not the other way round.
  const bg = dark ? DARK : GROUND;

  // Text colours: ink on bone, white on black
  const heading = dark ? "#ffffff" : INK_WARM;

  return (
    <motion.main
      className="relative h-screen overflow-hidden"
      style={{ backgroundColor: bg }}
      animate={{ backgroundColor: bg }}
      transition={{ duration: 0.6, ease: "easeInOut" }}
    >
      {/* ── Background video ───────────────────────────────────────────── */}
      {/*
        Same render pair, one per mood. Light plays the light-ground render at
        full strength on the bone page; dark plays the original on black. The
        ?v query keeps stale cached copies (watermarked, cropped) out.
      */}
      <video
        className="absolute inset-0 h-full w-full scale-100 object-cover object-center transition-transform duration-1000"
        src={dark ? DARK_VIDEO_SRC : LIGHT_VIDEO_SRC}
        autoPlay
        muted
        playsInline
        aria-hidden="true"
      />

      {/* ── Real site chrome ───────────────────────────────────────────── */}
      {/*
        The wordmark (tone follows the background: dark ink on bone, light
        white on black) top-left, and SiteChrome's burger + sheet + Get
        Started pill at the top-right — exactly the chrome every public page
        carries. openSignin hosts the auth dialog over this page, matching the
        landing hero's behavior.
      */}
      <div
        className="absolute top-0 left-0 z-30 px-6 py-6 transition-opacity duration-500 sm:px-10 sm:py-8"
        style={{ color: dark ? "#ffffff" : INK }}
      >
        <Wordmark tone={dark ? "light" : "dark"} />
      </div>

      <SiteChrome activeHref="/" onCtaClick={openSignin} />

      {/* ── Hero content ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center px-5 pt-24 pb-24 text-center sm:px-8 sm:pt-32 md:pt-48">
        {/* The landing's exact type treatment: Lato Black (font-body), the
            landing's clamp(2.25rem, 6vw, 4.5rem), tracking-[-0.03em]. */}
        <h1
          className="font-body mb-6 font-black leading-[1.05] tracking-[-0.03em] text-[clamp(2.25rem,6vw,4.5rem)] sm:mb-8"
          style={{ color: heading }}
        >
          <Headline color={heading} />
        </h1>

        {/* The signature CTA, exactly as the landing hero runs it: same
            component, tone, size and opener. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 2.0 }}
        >
          <BrandCtaButton
            type="button"
            label="Get Started"
            size="lg"
            onClick={openSignin}
          />
        </motion.div>
      </div>

      {/* ── Background toggle (fixed, bottom-right) ─────────────────────── */}
      {/*
        Read: "Dark" when on the bone page (click to go dark);
        "Light" when on the dark page (click to go back).
      */}
      <button
        type="button"
        onClick={() => setDark((v) => !v)}
        aria-pressed={dark}
        className="glass-toggle fixed bottom-5 right-5 z-[60] rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors duration-500"
        style={{
          color: dark ? "rgba(255,255,255,0.9)" : INK,
          background: dark ? "rgba(255,255,255,0.08)" : "rgba(28,26,24,0.06)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          boxShadow:
            "inset 0 1px 1px rgba(255,255,255,0.12), 0 1px 6px rgba(0,0,0,0.12)",
        }}
      >
        {dark ? "Light" : "Dark"}
      </button>
    </motion.main>
  );
}
