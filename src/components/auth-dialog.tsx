"use client";

import { useEffect, useState } from "react";

import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { XIcon } from "@/components/animate-ui/icons/x";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/animate-ui/primitives/radix/dialog";
import {
  Tabs,
  TabsContent,
  TabsContents,
} from "@/components/animate-ui/primitives/animate/tabs";

import { bannerClass, fieldVars } from "@/components/brand/fields";
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
    body: "text-[#0c1014]/50",
    close: "text-[#0c1014]/35 hover:bg-[#0c1014]/5 hover:text-[#0c1014] focus-visible:outline-[#0c1014]",
  },
  dark: {
    panel: INK_RAISED,
    notch: INK_RAISED,
    ring: "ring-1 ring-white/15",
    heading: GROUND,
    body: "text-[#f4f4ef]/55",
    close: "text-[#f4f4ef]/45 hover:bg-white/10 hover:text-[#f4f4ef] focus-visible:outline-[#f4f4ef]",
  },
} as const;

const COPY = {
  signin: {
    title: "Welcome.",
    body: "Accounts are created by an admin. Use the details you were invited with.",
  },
  forgot: {
    title: "Forgot Password?",
    body: "Enter your email and we\u2019ll send instructions if an account is available.",
  },
} as const;

/** Spring used by the sliding panels — matches the animate-ui tabs default. */
const PANEL_SPRING = {
  type: "spring" as const,
  stiffness: 300,
  damping: 30,
  bounce: 0,
  restDelta: 0.01,
};

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

  // The panel keeps rendering through its exit animation, by which point `view`
  // is already null — so the copy and the form have to come from the last view
  // that was actually open, or the dialog empties itself on the way out.
  // Adjusted during render rather than in an effect: React re-runs this
  // component immediately with the new value and never commits the stale one, so
  // the panel cannot flash the wrong copy for a frame.
  const [shown, setShown] = useState<AuthView>("signin");
  if (view && view !== shown) setShown(view);

  // Radix runs its autofocus once, when the dialog opens. Switching panels
  // replaces the form underneath it, so the field has to be claimed again.
  useEffect(() => {
    if (!view) return;
    // Small delay lets the slide animation start before we steal focus,
    // which prevents the browser from fighting the animated scroll position.
    const id = setTimeout(() => document.getElementById("email")?.focus(), 120);
    return () => clearTimeout(id);
  }, [view, shown]);

  return (
    <Dialog open={view !== null} onOpenChange={onOpenChange}>
      {/* Presence, portalling, and the flip entrance come from the animate-ui
          primitive (`npx shadcn add @animate-ui/components-radix-dialog`); only
          the surface below is ours. Its sibling `components/radix/dialog.tsx` is
          the shadcn-styled wrapper — deliberately unused, since it carries the
          app's neutral card look rather than this system's. */}
      <DialogPortal>
        <DialogOverlay
          // Ink rather than plain black: the page stays legible underneath,
          // which is the point of opening over it.
          className="fixed inset-0 z-[60] backdrop-blur-[5px]"
          style={{ backgroundColor: "rgba(12, 16, 20, 0.55)" }}
        />

        <DialogContent
          onEscapeKeyDown={markEscapeHandled}
          // Radix focuses the first tabbable node, which is the close button —
          // someone who opened this wants to start typing, so send focus to the
          // email field instead.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("email")?.focus();
          }}
          // outline-none on the panel itself: Radix makes the content focusable,
          // and switching panels unmounts whatever had focus, which drops it
          // back here and paints the UA's focus ring around the whole dialog.
          className={`fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl p-7 shadow-xl outline-none sm:p-9 ${t.ring}`}
          style={{
            backgroundColor: t.panel,
            maxHeight: "calc(100vh - 2rem)",
            ...fieldVars(tone, t.notch),
          }}
        >
          {/* asChild puts the trigger on the button rather than the glyph: the
              32px button is the affordance, and binding hover to the 16px icon
              inside it would leave the surrounding padding dead. */}
          <AnimateIcon asChild animateOnHover animateOnTap>
            <DialogClose
              aria-label="Close"
              className={`absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${t.close}`}
            >
              <XIcon size={16} strokeWidth={1.75} aria-hidden="true" />
            </DialogClose>
          </AnimateIcon>

          {/*
            Animate-ui Tabs drives both the header copy and the form body. No
            visible TabsList — the triggers are the "Forgot password?" and
            "Back to log in" links already inside the forms. The Tabs component
            just orchestrates the sliding + blur animation.
          */}
          <Tabs
            value={shown}
            onValueChange={(v) => onShow(v as AuthView)}
          >
            {/* ── Animated heading ── */}
            <TabsContents transition={PANEL_SPRING}>
              <TabsContent value="signin">
                <DialogTitle
                  className="font-body text-[clamp(1.75rem,4vw,2.25rem)] font-black leading-[1.05] tracking-[-0.03em]"
                  style={{ color: t.heading }}
                >
                  {COPY.signin.title}
                </DialogTitle>
                <DialogDescription
                  className={`mt-2 font-body text-sm leading-[1.65] ${t.body}`}
                >
                  {COPY.signin.body}
                </DialogDescription>
                {notice && (
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
              </TabsContent>

              <TabsContent value="forgot">
                <DialogTitle
                  className="font-body text-[clamp(1.75rem,4vw,2.25rem)] font-black leading-[1.05] tracking-[-0.03em]"
                  style={{ color: t.heading }}
                >
                  {COPY.forgot.title}
                </DialogTitle>
                <DialogDescription
                  className={`mt-2 font-body text-sm leading-[1.65] ${t.body}`}
                >
                  {COPY.forgot.body}
                </DialogDescription>
              </TabsContent>
            </TabsContents>

            {/* ── Animated form body ── */}
            {/*
              No social sign-in and no sign-up link. Accounts are created by an
              admin (PRD §4.2 prohibits public self-sign-up), so Google/Apple and a
              "Sign up" route would be affordances for something the platform does
              not do.
            */}
            <TabsContents transition={PANEL_SPRING}>
              <TabsContent value="signin">
                <LoginForm tone={tone} onForgotPassword={() => onShow("forgot")} />
              </TabsContent>
              <TabsContent value="forgot">
                <ForgotPasswordForm tone={tone} onBack={() => onShow("signin")} />
              </TabsContent>
            </TabsContents>
          </Tabs>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
