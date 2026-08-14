"use client";

import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useEffect } from "react";

import { bannerClass, fieldVars } from "@/components/brand/fields";
import { EASE } from "@/components/brand/motion";
import { GROUND, INK, INK_RAISED } from "@/components/brand/tokens";
import type { AuthView } from "@/components/brand/use-auth-dialog";
import { LoginForm } from "@/app/login/login-form";
import { ForgotPasswordForm } from "@/app/forgot-password/forgot-password-form";
import type { SignedOutNotice } from "@/lib/auth/signed-out-notice";

/**
 * `light` is the default — a bone panel over the bone page. `dark` is what opens
 * when the menu sheet is already up: a raised ink panel, so the dialog joins the
 * sheet's world instead of punching a bright hole in it.
 */
export type AuthTone = "light" | "dark";

/**
 * Radix dismisses on Escape from a *capture*-phase listener, and React flushes
 * discrete events synchronously — so by the time any ordinary listener runs, the
 * dialog has already closed and the URL has already reverted. Nothing downstream
 * can tell that this keypress was spoken for by looking at state.
 *
 * So the event itself carries the mark. The menu sheet checks it before closing
 * on Escape; without it, one press would close the dialog *and* the sheet
 * underneath it.
 */
const HANDLED = Symbol.for("180connect.escape-handled");

type MarkedEvent = KeyboardEvent & { [HANDLED]?: true };

export const markEscapeHandled = (event: KeyboardEvent) => {
  (event as MarkedEvent)[HANDLED] = true;
};

export const wasEscapeHandled = (event: KeyboardEvent) =>
  (event as MarkedEvent)[HANDLED] === true;

/**
 * Per-tone surface values. Everything below reads off this rather than branching
 * inline, so a tone cannot end up half-applied — and `notch` is published as a
 * CSS variable because the floating labels sit *across* the field's top border
 * and have to paint the panel's own colour behind themselves to cut it.
 */
const TONES = {
  light: {
    panel: GROUND,
    notch: GROUND,
    ring: "",
    heading: INK,
    eyebrow: "text-[#0c1014]/40",
    body: "text-[#0c1014]/50",
    close: "text-[#0c1014]/35 hover:bg-[#0c1014]/5 hover:text-[#0c1014] focus-visible:outline-[#0c1014]",
  },
  dark: {
    panel: INK_RAISED,
    notch: INK_RAISED,
    ring: "ring-1 ring-white/15",
    heading: GROUND,
    eyebrow: "text-[#f4f4ef]/45",
    body: "text-[#f4f4ef]/55",
    close: "text-[#f4f4ef]/45 hover:bg-white/10 hover:text-[#f4f4ef] focus-visible:outline-[#f4f4ef]",
  },
} as const;

const COPY = {
  signin: {
    eyebrow: "Sign in",
    title: "Welcome.",
    body: "Accounts are created by an admin. Use the details you were invited with.",
  },
  forgot: {
    eyebrow: "Reset password",
    title: "Forgot it?",
    body: "Enter your email and we'll send instructions if an account is available.",
  },
} as const;

/**
 * Signing in and resetting a password both happen here, over whichever public
 * page you are already on: nobody signs up, so there is no account funnel to
 * land in — just one door, opened where you already are.
 *
 * `/login` and `/forgot-password` still exist as routes and still render this,
 * because a great deal redirects to them and two of those carry a notice in the
 * query string. See docs/design-system.md § Signing in.
 */
export function AuthDialog({
  view,
  onOpenChange,
  onShow,
  tone = "light",
  notice,
}: {
  view: AuthView | null;
  onOpenChange: (open: boolean) => void;
  onShow: (view: AuthView) => void;
  tone?: AuthTone;
  notice?: SignedOutNotice | null;
}) {
  const t = TONES[tone];
  const copy = view ? COPY[view] : null;

  // Radix runs its autofocus once, when the dialog opens. Switching panels
  // replaces the form underneath it, so the field has to be claimed again.
  useEffect(() => {
    if (!view) return;
    document.getElementById("email")?.focus();
  }, [view]);

  return (
    <Dialog.Root open={view !== null} onOpenChange={onOpenChange}>
      {/* forceMount hands the open/close animation to Motion — Radix would
          otherwise unmount the moment `open` flips and the exit never plays. */}
      <AnimatePresence>
        {view && copy && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                // Ink rather than plain black, and blurred: the page stays
                // legible underneath, which is the point of opening over it.
                className="fixed inset-0 z-[60] backdrop-blur-[5px]"
                style={{ backgroundColor: "rgba(12, 16, 20, 0.55)" }}
              />
            </Dialog.Overlay>

            <Dialog.Content
              asChild
              forceMount
              onEscapeKeyDown={markEscapeHandled}
              // Radix focuses the first tabbable node, which is the close
              // button — someone who opened this wants to start typing, so send
              // focus to the email field instead.
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                document.getElementById("email")?.focus();
              }}
            >
              <motion.div
                // The house entrance, shortened: a dialog answering a click has
                // to feel immediate in a way a page entrance does not.
                initial={{ opacity: 0, y: 16, scale: 0.97, filter: "blur(10px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(6px)" }}
                transition={{ duration: 0.4, ease: EASE }}
                // outline-none on the panel itself: Radix makes the content
                // focusable, and switching panels unmounts whatever had focus,
                // which drops it back here and paints the UA's focus ring around
                // the whole dialog. Focus is sent to the email field instead
                // (below), so nothing is lost by suppressing it.
                className={`fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md outline-none -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl p-7 shadow-xl sm:p-9 ${t.ring}`}
                style={{
                  backgroundColor: t.panel,
                  maxHeight: "calc(100vh - 2rem)",
                  ...fieldVars(tone, t.notch),
                }}
              >
                <Dialog.Close
                  aria-label="Close"
                  className={`absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${t.close}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </Dialog.Close>

                <p
                  className={`font-body text-[11px] font-bold uppercase tracking-[0.12em] ${t.eyebrow}`}
                >
                  {copy.eyebrow}
                </p>

                <Dialog.Title
                  className="mt-2.5 font-body text-[clamp(1.75rem,4vw,2.25rem)] font-black leading-[1.05] tracking-[-0.03em]"
                  style={{ color: t.heading }}
                >
                  {copy.title}
                </Dialog.Title>

                <Dialog.Description
                  className={`mt-2 font-body text-sm leading-[1.65] ${t.body}`}
                >
                  {copy.body}
                </Dialog.Description>

                {notice && view === "signin" && (
                  <div
                    role="status"
                    className={`mt-5 ${bannerClass(
                      tone,
                      notice.tone === "success" ? "success" : "pending",
                    )}`}
                  >
                    {notice.message}
                  </div>
                )}

                {/*
                  No social sign-in and no sign-up link. Accounts are created by
                  an admin (PRD §4.2 prohibits public self-sign-up), so
                  Google/Apple and a "Sign up" route would be affordances for
                  something the platform does not do.
                */}
                {view === "signin" ? (
                  <LoginForm tone={tone} onForgotPassword={() => onShow("forgot")} />
                ) : (
                  <ForgotPasswordForm tone={tone} onBack={() => onShow("signin")} />
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
