"use client";

import {
  animate,
  MotionConfig,
  motion,
  useMotionTemplate,
  useMotionValue,
  useTransform,
} from "motion/react";
import Image from "next/image";
import { useEffect } from "react";

import { BrandCtaButton } from "@/components/brand/brand-cta";
import { EASE, entrance, stagger } from "@/components/brand/motion";
import { SiteChrome } from "@/components/brand/site-chrome";
import { useAuthDialog } from "@/components/brand/use-auth-dialog";
import { GROUND, INK_WARM } from "@/components/brand/tokens";
import { Wordmark } from "@/components/brand/wordmark";
import type { SignedOutNotice } from "@/lib/auth/signed-out-notice";

/**
 * The copy block enters as one staggered run in reading order: headline, then
 * CTA. `delayChildren` holds it back just long enough for the photo squares to
 * have started resolving underneath — except when the intro is skipped, where
 * there is nothing to wait for.
 */
const stack = (skipIntro: boolean) => stagger(0.09, skipIntro ? 0 : 0.75);

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
  /** Stays blurred after entrance — reads as depth-of-field behind the sharp crops. */
  blur?: boolean;
};

const squares: CropSpec[] = [
  { left: 88, top: 4, size: 138, src: "/crops/leaf-bark-right.png", className: "", hero: true },
  { left: 42, top: 9, size: 85, src: "/crops/leaf-branch-soft.png", className: "" },
  { left: 17, top: 19, size: 157, src: "/crops/leaf-bark.png", className: "hidden sm:block" },
  { left: 4, top: 15, size: 96, src: "/crops/leaf-vine.png", className: "", hero: true },
  { left: 60, top: 34, size: 65, src: "/crops/leaf-fern-left.png", className: "hidden md:block", blur: true },
  { left: 76, top: 32, size: 135, src: "/crops/leaf-float-center.png", className: "", blur: true },
  { left: 4, top: 43, size: 96, src: "/crops/leaf-branch-alt.png", className: "hidden lg:block" },
  { left: 30, top: 56, size: 242, src: "/crops/leaf-moss.png", className: "" },
  { left: 56, top: 74, size: 178, src: "/crops/leaf-fern.png", className: "hidden sm:block" },
  { left: 89, top: 62, size: 118, src: "/crops/leaf-bark.png", className: "hidden sm:block" },
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
  // Settles into a soft blur rather than fully sharp — depth-of-field, not a
  // second entrance state, so it still resolves from the same blur(10px) start.
  const restBlur = crop.blur ? "blur(4px)" : "blur(0px)";

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
      animate={{ opacity: 1, scale: 1, x: 0, filter: restBlur }}
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
        <Image src={crop.src} alt="" width={crop.size} height={crop.size} className="w-full h-full" unoptimized />
      </motion.div>
    </motion.div>
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
 * social icons: no extra request, and the mark inherits the headline's `em`
 * sizing directly.
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
    <Image
      src="/gmail.svg"
      alt="Gmail"
      width={24}
      height={24}
      className="inline-block h-[0.6em] w-auto -translate-y-[0.06em] align-middle"
    />
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

export default function Landing({
  skipIntro = false,
  notice = null,
}: {
  /**
   * Set when an auth route (/login, /forgot-password) is rendering this rather
   * than /. The dialog is already open over the top, and someone redirected here
   * by an expired session is waiting to log in, not watching a title sequence.
   */
  skipIntro?: boolean;
  /** Passed straight to the dialog; only /login ever has one. */
  notice?: SignedOutNotice | null;
}) {
  // Only for the hero button — the chrome renders the dialog itself.
  const { openSignin } = useAuthDialog();

  // 1 = full splash (big, centred low), 0 = settled into the nav corner.
  // Chrome, CTA, and leaf crops blur in a little before the shrink finishes.
  // Everything below reads off these two motion values via `calc()`, same as
  // the scroll-driven version — only the source (a timer, not scroll) changed.
  const introT = useMotionValue(skipIntro ? 0 : 1);
  const revealT = useMotionValue(skipIntro ? 1 : 0);

  useEffect(() => {
    if (skipIntro) return;
    const shrink = animate(introT, 0, { duration: 2.2, ease: EASE, delay: 1.8 });
    const reveal = animate(revealT, 1, { duration: 0.8, ease: EASE, delay: 2.9 });
    return () => {
      shrink.stop();
      reveal.stop();
    };
  }, [introT, revealT, skipIntro]);

  const revealY = useTransform(revealT, [0, 1], [14, 0]);
  // Templated (not passed as a bare `y`) so it goes through the same plain
  // style path as revealFilter — Motion applies raw `y`/`x`/etc transform
  // shorthand imperatively via ref, skipping React's client render tree,
  // which desyncs from the SSR-rendered `transform` and trips a hydration
  // mismatch. Templating forces it into the ordinary style codepath.
  const revealTransform = useMotionTemplate`translateY(${revealY}px)`;
  const revealBlur = useTransform(revealT, [0, 1], [10, 0]);
  const revealFilter = useMotionTemplate`blur(${revealBlur}px)`;
  const reveal = {
    opacity: revealT,
    transform: revealTransform,
    filter: revealFilter,
  };

  return (
    // "user" honours prefers-reduced-motion: transforms are dropped, opacity
    // fades survive, so the page still resolves rather than snapping in.
    <MotionConfig reducedMotion="user">
      <motion.main
        className="relative flex flex-1 flex-col overflow-hidden"
        style={{ "--t": introT, backgroundColor: GROUND } as React.CSSProperties}
      >
        {/* The scatter can only start below the CTA, which on a wide desktop
            leaves the whole band beside the headline empty — this layer fills
            it. Anchored to the viewport rather than to the scatter's box, and
            behind the copy (which carries z-10) so a crop can pass under the
            text without ever competing with it. Positions stay in the margins
            regardless, well clear of the headline's measure. */}
        <div
          className="pointer-events-none absolute inset-0 z-0 hidden md:block"
          aria-hidden="true"
        >
          {squares.map((sq, i) =>
            sq.hero ? <Crop key={i} crop={sq} delay={skipIntro ? 0 : cropDelays[i]} index={i} /> : null,
          )}
        </div>

        {/* Sits *below* the sheet: the light twin inside the sheet is revealed
            by the same circle that paints the ink, so the swap is exact by
            construction instead of a delay guessing when the edge arrives.
            translate-x shifts the whole lockup right in splash mode so the big
            globe doesn't clip the viewport left edge. */}
        <div className="absolute top-0 left-0 z-30 translate-x-[calc(2.5rem*var(--t,1))] px-6 py-6 sm:px-10 sm:py-8">
          <Wordmark tone="dark" scroll />
        </div>

        <SiteChrome revealStyle={reveal} activeHref="/" onCtaClick={openSignin}
          notice={notice} />

        <motion.div
          // The wordmark and burger are absolute now, so this pad stands in for
          // the height they used to occupy in flow.
          className="relative z-10 flex flex-1 flex-col px-6 pt-[76px] sm:px-10 sm:pt-[92px]"
          variants={stack(skipIntro)}
          initial="hidden"
          animate="show"
        >
          <div
            className="flex flex-col items-center gap-6 text-center"
            style={{
              paddingTop: "calc(54vh * var(--t, 1) + 8rem * (1 - var(--t, 1)))",
            }}
          >
            <motion.h1
              variants={entrance}
              className="font-body text-[clamp(2.25rem,6vw,4.5rem)] font-black leading-[1.05] tracking-[-0.03em]"
              style={{ color: INK_WARM }}
            >
              Replace <SheetsMark /> spreadsheets, <GmailMark /> follow-ups
              <br />
               and <MondayMark /> tracking. All in one place.
            </motion.h1>
          </div>

          {/* z-10 makes this a stacking context, which is what lets the leaf
              below sit behind the button while still covering the page. */}
          <motion.div
            style={reveal}
            className="relative z-10 flex justify-center pt-8 sm:pt-10"
          >
            {/* A crop pulled up out of the scatter below and parked under the
                CTA, so the capsule's backdrop-blur has something to blur.
                Anchored to this wrapper rather than positioned in the scatter
                grid, so it tracks the button at every width. Sized and placed to
                clear the copy above it: below lg that copy runs full width, and
                a taller crop reached up into it. */}
            <div
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

            <BrandCtaButton type="button" label="Get Started" size="lg" onClick={openSignin} />
          </motion.div>

          {/* Scattered crops of the same source photo — a few left soft to
              read as depth-of-field rather than a gallery grid. */}
          <div className="relative mt-10 h-[360px] flex-1 sm:h-[460px] lg:h-[520px]">
            {squares.map((sq, i) =>
              sq.hero ? null : <Crop key={i} crop={sq} delay={skipIntro ? 0 : cropDelays[i]} index={i} />,
            )}
          </div>
        </motion.div>
      </motion.main>
    </MotionConfig>
  );
}
