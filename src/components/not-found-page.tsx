"use client";

import { MotionConfig, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { BrandCta } from "@/components/brand/brand-cta";
import { EASE, entrance, stagger } from "@/components/brand/motion";
import { MAIL } from "@/components/brand/nav";
import { SiteChrome } from "@/components/brand/site-chrome";
import { GROUND, INK_WARM } from "@/components/brand/tokens";
import { useAuthDialog } from "@/components/brand/use-auth-dialog";
import { Wordmark } from "@/components/brand/wordmark";
import { OFFICE_CLOCKS, officeTimeIn } from "@/lib/local-time";

/**
 * The site's 404, reached by any URL that matches no route — a mistyped client
 * id, a link from an old email, a bookmark that has outlived its page.
 *
 * It is a *public* page in the sense that matters here: whoever lands on it may
 * be signed in or not, so it carries the same chrome as the rest of the
 * marketing surface and holds no data of any kind. There is nothing on it to
 * withhold from a viewer, and nothing a viewer could change — the one control
 * that goes anywhere is a read-only navigation, so the page needs no
 * view-only decision of its own. (See AGENTS.md → "Roles: every control answers
 * for a viewer".)
 *
 * The copy says "page not found" rather than the number. A visitor does not
 * need the word 404 to understand where they are, and the one thing they do
 * need — that nothing on their side is broken — is what the body says.
 */
export default function NotFoundPage({
  isSignedIn = false,
}: {
  /**
   * True when the visitor already holds a session. Decides where the single
   * lime CTA points: someone signed in is most likely after the app, someone
   * signed out after the site.
   */
  isSignedIn?: boolean;
}) {
  // Only for the chrome's pill — the chrome renders the dialog itself. A page
  // that passed nothing here would leave the pill as a plain link to /login,
  // which opens the same dialog over the landing page.
  const { openSignin } = useAuthDialog();

  return (
    // "user" honours prefers-reduced-motion: transforms are dropped, opacity
    // fades survive, so the page resolves instead of snapping in.
    <MotionConfig reducedMotion="user">
      <main
        className="relative flex min-h-screen flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: GROUND }}
      >
        {/* Leaf crops as texture, not illustration: two pinned to the right
            margin and one running off the bottom-left corner, all clear of the
            copy's measure at every width and none of them clickable. They are
            the landing page's source photography, reused through the same
            pre-cut files in public/crops/ — never cropped in CSS. */}
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          <motion.div
            {...cropEntrance(0.15, 36)}
            className="absolute top-[22%] right-[-4%] hidden h-[220px] w-[220px] sm:block"
          >
            <Image
              src="/crops/leaf-bark-right.png"
              alt=""
              fill
              sizes="220px"
              className="object-cover"
            />
          </motion.div>
          {/* Runs off the right edge rather than sitting in the margin: the
              clock strip occupies that margin, and a blurred leaf behind the
              times would blunt them. */}
          <motion.div
            {...cropEntrance(0.3, 36)}
            className="absolute right-[-3%] bottom-[4%] hidden h-[150px] w-[150px] lg:block"
          >
            <Image
              src="/crops/leaf-fern-left.png"
              alt=""
              fill
              sizes="150px"
              className="object-cover blur-[4px]"
            />
          </motion.div>
          <motion.div
            {...cropEntrance(0.45, -36)}
            className="absolute bottom-[-6%] left-[-3%] hidden h-[180px] w-[180px] lg:block"
          >
            <Image
              src="/crops/leaf-vine.png"
              alt=""
              fill
              sizes="180px"
              className="object-cover blur-[3px]"
            />
          </motion.div>
        </div>

        {/* Sits under the chrome, exactly as on every other public page: the
            menu sheet wipes its own copy of the wordmark over this one. */}
        <header className="absolute top-0 left-0 z-30 px-6 py-6 sm:px-10 sm:py-8">
          <Link
            href="/"
            aria-label="180Connect home"
            className="focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            <Wordmark tone="dark" />
          </Link>
        </header>

        <SiteChrome onCtaClick={openSignin} isSignedIn={isSignedIn} />

        <div className="relative z-10 flex flex-1 flex-col justify-center px-6 pt-[124px] pb-20 sm:px-10 lg:px-16">
          {/* Copy left, clocks right, once there is width for two columns; a
              single stacked column below that, with the strip under the links
              where it still reads as an aside rather than a second headline. */}
          <div className="mx-auto w-full max-w-[1100px] lg:flex lg:items-end lg:justify-between lg:gap-20">
            {/* Reading order, one wave: eyebrow, headline, body, action, then
                the links. The delay keeps the words off the screen until the
                crops have begun to settle underneath them. */}
            <motion.div
              initial="hidden"
              animate="show"
              variants={stagger(0.09, 0.12)}
              className="lg:min-w-0 lg:max-w-[640px]"
            >
              <motion.p
                variants={entrance}
                className="font-body text-[11px] font-bold tracking-[0.12em] text-[#0c1014]/35 uppercase"
              >
                Page not found
              </motion.p>

              <motion.h1
                variants={entrance}
                className="mt-4 max-w-[16ch] font-body text-[clamp(2.5rem,7vw,4.5rem)] leading-[1.02] font-black tracking-[-0.03em]"
                style={{ color: INK_WARM }}
              >
                Nothing grows at this address.
              </motion.h1>

              <motion.p
                variants={entrance}
                className="mt-6 max-w-xl font-body text-[15px] leading-[1.8] text-[#0c1014]/55"
              >
                {isSignedIn
                  ? "The link is out of date, or the page has moved. Nothing you were working on is affected — it is all still where you left it."
                  : "The link may be out of date, or the page has moved. Nothing is broken on your side — this address just isn't one of ours."}
              </motion.p>

              {/* The one lime accent on the page. */}
              <motion.div variants={entrance} className="mt-9">
                <BrandCta
                  href={isSignedIn ? "/dashboard" : "/"}
                  label={isSignedIn ? "Go to the app" : "Back to home"}
                  ariaLabel={isSignedIn ? "Go to the app" : "Back to home"}
                  size="lg"
                />
              </motion.div>

              <motion.div
                variants={entrance}
                className="mt-14 max-w-2xl border-t border-[#0c1014]/8 pt-6"
              >
                <p className="font-body text-[11px] font-bold tracking-[0.12em] text-[#0c1014]/30 uppercase">
                  Where to next
                </p>

                {/* Written out here rather than read off `menuLinks`: two of
                    that sheet's five destinations (/changelog, /cookies) have
                    no route behind them yet, and a 404 is no place to hand
                    someone a second one. */}
                <ul className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                  {LINKS.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="group inline-flex items-center gap-2 font-body text-[13px] font-medium text-[#0c1014]/50 transition-colors hover:text-[#0c1014] focus-visible:text-[#0c1014] focus-visible:outline-2 focus-visible:outline-offset-4"
                      >
                        {link.label}
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                          aria-hidden="true"
                        >
                          <path d="M5 12h14" />
                          <path d="m13 6 6 6-6 6" />
                        </svg>
                      </Link>
                    </li>
                  ))}
                </ul>
              </motion.div>
            </motion.div>

            {/* Its own stagger container so the strip lands a beat after the
                copy rather than with it: one wave, then the clocks at 0.55s.
                Reading order is the whole point of the entrance, and the times
                are the last thing the eye should reach. */}
            <motion.div
              initial="hidden"
              animate="show"
              variants={stagger(0, 0.55)}
              className="mt-14 lg:mt-0 lg:shrink-0"
            >
              <motion.div variants={entrance}>
                <CityClocks />
              </motion.div>
            </motion.div>
          </div>
        </div>
      </main>
    </MotionConfig>
  );
}

/**
 * The team's three home cities, each showing the time it is there right now.
 *
 * Rendered from the browser's clock only. The server cannot know which minute
 * the visitor will read the page in, and formatting the *server's* time into
 * the HTML would hydrate into a mismatch the moment the two disagreed — so the
 * first paint is the placeholder and the real times arrive a tick later, on
 * mount. Held in `now` rather than passed in, so every office reads off one
 * instant: three separate `new Date()` calls could straddle a minute boundary
 * and show three different minutes.
 *
 * The zones themselves, the 12-hour reading and the am/pm marker all come from
 * `src/lib/local-time.ts` — tested there rather than here, because a wrong zone
 * id, a midnight rendered as `0:30 am` or a missing marker are all the kind of
 * mistake that only shows up in a browser.
 */
function CityClocks() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const current = new Date();
      setNow(current);
      // Re-armed on every tick rather than a plain 60s interval, so a machine
      // that slept through one wakes up and corrects on the next instead of
      // drifting — and there is no seconds digit on screen, so waking sixty
      // times a minute would re-render for nothing.
      timer = setTimeout(tick, 60_000 - (current.getTime() % 60_000) + 50);
    };

    tick();
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="lg:w-[210px]">
      <p className="font-body text-[11px] font-bold tracking-[0.12em] text-[#0c1014]/30 uppercase">
        Team time
      </p>

      <ul className="mt-4 flex flex-col">
        {OFFICE_CLOCKS.map((office) => {
          // Read once per row rather than inside the JSX, so the reading and its
          // marker can never come from two different instants.
          const clock = now ? officeTimeIn(now, office.timeZone) : null;

          return (
            <li
              key={office.city}
              className="flex items-baseline justify-between gap-4 border-b border-[#0c1014]/6 py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
              <span className="font-body text-[13px] leading-snug text-[#0c1014]/55">
                {office.city}
                <span className="block text-[11px] text-[#0c1014]/35">
                  {office.country}
                </span>
              </span>
              {/* tabular-nums holds the column still as the digits change, so
                  the times do not shuffle sideways each minute. The marker
                  steps down to 11px and back to the muted ink: at the reading's
                  own size `pm` would be the loudest thing in the strip, and it
                  is the least of what the row is saying. */}
              <span className="font-body text-[15px] font-bold text-[#0c1014] tabular-nums">
                {clock ? (
                  <>
                    {clock.time}
                    <span className="ml-1 text-[11px] font-medium text-[#0c1014]/40">
                      {clock.period}
                    </span>
                  </>
                ) : (
                  "--:--"
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The public destinations worth offering from a dead end, plus the team. */
const LINKS = [
  { label: "Home", href: "/" },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Email us", href: `mailto:${MAIL}` },
] as const;

/**
 * The crops settle the way the landing page's do — swelling from small while
 * drifting the last stretch into place — so the corner reads as part of the
 * same picture rather than a decoration dropped on a 404.
 *
 * Direction reads off which side the crop lives on: the ones on the right
 * arrive from the right (+36) and the one on the left from the left (-36), so
 * the group converges as it lands instead of sliding across as one sheet.
 *
 * Passed as props rather than variants: these sit outside the copy's stagger
 * tree, so each carries its own delay and Motion's `custom` would have nothing
 * to feed it.
 */
function cropEntrance(delay: number, drift: number) {
  return {
    initial: { opacity: 0, x: drift, scale: 0.74, filter: "blur(12px)" },
    animate: { opacity: 1, x: 0, scale: 1, filter: "blur(0px)" },
    transition: { duration: 1.2, ease: EASE, delay },
  };
}
