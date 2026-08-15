"use client";

import { AnimatePresence, motion, type MotionStyle } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AuthDialog, wasEscapeHandled } from "@/components/auth-dialog";
import type { SignedOutNotice } from "@/lib/auth/signed-out-notice";
import { BrandCta, BrandCtaButton } from "./brand-cta";
import { useAuthDialog } from "./use-auth-dialog";
import { EASE, sheet, sheetItem } from "./motion";
import { menuLinks, socials } from "./nav";
import { GROUND, INK, LIME } from "./tokens";
import { TreeMark, Wordmark } from "./wordmark";

/**
 * The top-right chrome every public page carries: the Get Started pill, the
 * burger, and the menu sheet they open.
 *
 * The wordmark is *not* here — pages render their own, because the landing page
 * needs the scroll-driven variant that starts as a full-width splash. The sheet's
 * light copy is rendered below at the same coordinates, so whatever a page puts
 * in that corner, the circle wipes one into the other with no cross-fade.
 *
 * Geometry (`right-[68px]`/`sm:right-[86px]`, `mt-6`/`sm:mt-8`) is the burger's
 * own gutter plus its 44px box plus a gap. Every copy of these offsets must match
 * or the sheet's CTA will not land on the one underneath it.
 */
export function SiteChrome({
  revealStyle,
  activeHref,
  showCta = true,
  onCtaClick,
  notice,
}: {
  /**
   * Applied to the pill and the burger. The landing page uses it to hold both
   * back until its intro animation has finished; other pages omit it.
   */
  revealStyle?: MotionStyle;
  /** Menu link to mark as the current page. */
  activeHref?: string;
  /**
   * The login page drops the pill — it is already the place the pill points at,
   * and the sheet's copy goes with it so the two stay in step.
   */
  showCta?: boolean;
  /**
   * Opens the login dialog in place instead of navigating. The landing page
   * passes this; pages that don't host the dialog leave it off and the pill
   * stays a plain link to /login, which opens the dialog over the landing.
   */
  onCtaClick?: () => void;
  /** Only ever set by /login and /forgot-password, from their query string. */
  notice?: SignedOutNotice | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Derived from the URL, so calling this here as well as in a host page that
  // wants its own opener cannot produce two disagreeing copies of the state.
  const auth = useAuthDialog();

  // Escape closes the sheet — the burger is the only other way out, and it can
  // scroll out of reach on short viewports.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Not `!auth.open`: Radix dismisses from a capture-phase listener and
      // React flushes the resulting re-render synchronously, so by the time this
      // runs the dialog has already closed and the state says so. The event's
      // own mark is the only thing that still remembers. See markEscapeHandled.
      if (e.key === "Escape" && !wasEscapeHandled(e)) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  return (
    <>
      {/* z-30 keeps this *under* the sheet rather than above it like the burger:
          the opening circle paints straight over it, and the sheet's own copy
          takes its place with no state of its own to animate. */}
      {showCta && (
        <motion.div
          style={revealStyle}
          className="absolute top-0 right-[68px] z-30 mt-6 flex h-11 items-center sm:right-[86px] sm:mt-8"
        >
          {onCtaClick ? (
            <BrandCtaButton
              type="button"
              label="Get Started"
              size="sm"
              ariaLabel="Get started"
              onClick={onCtaClick}
            />
          ) : (
            <BrandCta href="/login" size="sm" ariaLabel="Get started" />
          )}
        </motion.div>
      )}

      {/* Three lines that fold into an X: the outer bars meet in the middle and
          cross, the middle bar drops out underneath them. Kept above the sheet
          so it stays clickable once the menu is open. */}
      <motion.button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        className="absolute top-0 right-0 z-50 mt-6 mr-4 flex h-11 w-11 items-center justify-center sm:mt-8 sm:mr-8"
        style={revealStyle}
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
                backgroundColor: menuOpen ? GROUND : INK,
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
            className="fixed inset-0 z-40 flex flex-col justify-center px-6 sm:px-10"
            style={{ backgroundColor: INK }}
          >
            {/* Same position as the page's own wordmark underneath, so the
                circle wipes one into the other with no cross-fade. */}
            <div className="absolute top-0 left-0 px-6 py-6 sm:px-10 sm:py-8">
              <Wordmark tone="light" />
            </div>

            {/* Oversized and pushed past the corner so it reads as a crop of
                something larger rather than a placed icon. The box follows the
                artwork's portrait ratio and bleeds off the right edge only —
                pushing it down as well would cut the roots. */}
            <motion.div
              variants={sheetItem}
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
                    className="font-body text-[clamp(2.5rem,8vw,5.5rem)] font-black leading-[1.05] tracking-[-0.03em] transition-opacity hover:opacity-50"
                    style={{ color: link.href === activeHref ? LIME : GROUND }}
                  >
                    {link.label}
                  </Link>
                </motion.div>
              ))}
            </nav>

            {/* Sized and placed to land exactly on the pill underneath — same
                three offsets, same 36px halves — so opening the sheet reads as
                that button turning white rather than one button leaving and
                another arriving. Unlike the other sheet children this wrapper
                carries no `sheetItem` entrance: it must already be sitting in
                its final place, unanimated, before the circle starts opening, so
                the clip-path reveal is the only thing that makes it appear. */}
            {showCta && (
              <div className="absolute top-0 right-[68px] mt-6 flex h-11 items-center sm:right-[86px] sm:mt-8">
                {onCtaClick ? (
                  <BrandCtaButton
                    type="button"
                    label="Get Started"
                    tone="sheet"
                    size="sm"
                    ariaLabel="Get started"
                    // The sheet stays up: the dialog opens over it in the
                    // sheet's own colours, so the menu is still there when the
                    // dialog closes rather than having vanished behind it.
                    onClick={onCtaClick}
                  />
                ) : (
                  <BrandCta
                    href="/login"
                    tone="sheet"
                    size="sm"
                    onClick={() => setMenuOpen(false)}
                  />
                )}
              </div>
            )}

            {/* Sits above the tree, which is decorative and pointer-events-none,
                so these stay clickable where the two overlap. */}
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
                    rel={
                      social.href.startsWith("http")
                        ? "noopener noreferrer"
                        : undefined
                    }
                    aria-label={social.label}
                    className="text-[#f4f4ef]/60 transition-colors hover:text-[#f4f4ef]"
                  >
                    {/* Frame 0 until hovered, then the sprite steps through its
                        frames — see .icon-sprite in globals.css. Linktree is a
                        single-frame sheet, so it simply sits still. */}
                    <span
                      className={`icon-sprite ${social.sprite} block opacity-60 transition-opacity hover:opacity-100`}
                      aria-hidden="true"
                    />
                  </a>
                ))}
              </div>

              {/* mx-auto centres it in what's left of the row after the icons,
                  which lands it in the gap before the tree rather than under it;
                  the translate biases it back towards the icons. Translating
                  rather than changing the margins keeps the centring maths
                  intact at every width. */}
              <p
                suppressHydrationWarning
                className="font-body text-xs tracking-[0.02em] text-[#f4f4ef]/40 sm:mx-auto sm:-translate-x-40"
              >
                © {new Date().getFullYear()} 180 Degrees Consulting Sheffield
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rendered here rather than by each page: this component is the only
          thing that knows whether the ink sheet is up, which is what decides
          the dialog's tone. */}
      <AuthDialog
        view={auth.view}
        onOpenChange={auth.onOpenChange}
        onShow={auth.show}
        tone={menuOpen ? "dark" : "light"}
        notice={notice}
      />
    </>
  );
}
