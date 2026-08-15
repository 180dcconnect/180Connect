"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

/**
 * The Cloudflare Turnstile widget (F003), shared by every unauthenticated form
 * that needs one.
 *
 * Rendered **explicitly**, not implicitly. Turnstile's implicit mode scans the
 * DOM for `.cf-turnstile` once, when `api.js` executes, and `next/script`
 * de-duplicates that script for the rest of the session. Login and forgot
 * password link to each other, so the second page is reached by a client-side
 * navigation: the script never runs again, the freshly mounted container is
 * never rendered into, and the visitor is left with a hint pointing at a widget
 * that does not exist and a submit button that can never enable. `onReady` fires
 * on first load *and* on every subsequent mount, which is what makes an explicit
 * `render()` call reliable across navigations.
 *
 * The site key is public by design — it identifies the widget, and only the
 * paired secret (held by Supabase) can validate a token. Read as a static
 * property so Next inlines it into the browser bundle; there is no fallback on
 * purpose, because a wrong-but-present key fails in confusing ways.
 * `src/lib/env.ts` requires it, so a missing key stops the server at startup.
 */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * How long to wait for `api.js` to define `window.turnstile` before declaring
 * the check unavailable.
 *
 * `<Script onError>` catches an outright failed request, but a filtering
 * extension or captive portal can answer with an empty 200 instead — the load
 * event fires, nothing is defined, and no error handler ever runs. This is the
 * backstop for that case. It only ever fires when no widget was rendered, so a
 * visitor slowly working through an interactive challenge is unaffected.
 */
const SCRIPT_TIMEOUT_MS = 10_000;

/** The subset of the Turnstile browser API this component uses. */
type TurnstileOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": (code?: string) => void;
  "timeout-callback": () => void;
  "refresh-expired": "auto" | "manual" | "never";
};

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: TurnstileOptions,
      ) => string | undefined;
      reset: (widget?: string | HTMLElement) => void;
      remove: (widget?: string | HTMLElement) => void;
    };
  }
}

/** Id of the hint paragraph, for the submit button's `aria-describedby`. */
export const CAPTCHA_HINT_ID = "captcha-hint";

export function TurnstileChallenge({
  solved,
  onSolvedChange,
  action,
  gerund,
  resetKey,
  tone = "light",
}: {
  solved: boolean;
  onSolvedChange: (solved: boolean) => void;
  /** What the check gates, as a bare verb phrase: "log in". */
  action: string;
  /** The same thing as a gerund, for the failure sentence: "logging in". */
  gerund: string;
  /**
   * Change this to spend the current token and start a fresh challenge. A
   * Turnstile token is single-use, so an attempt that comes back as a failure
   * has already burnt one: without a reset the next submission replays a spent
   * token and Supabase rejects it as a CAPTCHA failure no matter what the user
   * typed. Callers pass the action state they got back, which is a new object
   * per attempt.
   */
  resetKey?: unknown;
  /**
   * Matches the surface the challenge sits on. Only the hint sentence changes —
   * the widget itself is Cloudflare's iframe and is not ours to restyle.
   */
  tone?: "light" | "dark";
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Set when the check cannot be presented at all — the script was blocked, or
  // Turnstile reported a configuration error such as a site key that does not
  // match this hostname. Distinct from "not solved yet": without it the visitor
  // is told to complete a check that is not there.
  const [unavailable, setUnavailable] = useState(false);

  // Read through a ref so `renderWidget` never has to be rebuilt to pick up a
  // new callback identity. Re-rendering the widget would discard a token the
  // visitor has already earned.
  const onSolvedChangeRef = useRef(onSolvedChange);
  useEffect(() => {
    onSolvedChangeRef.current = onSolvedChange;
  }, [onSolvedChange]);

  // Flipped by `<Script onReady>`, which fires both on first load and on every
  // later mount — including mounts where the script is already in memory, which
  // is exactly the client-side navigation case that implicit rendering misses.
  const [scriptReady, setScriptReady] = useState(false);

  // Rendering and teardown share one effect on purpose, so that every widget is
  // removed by the same cycle that created it. Splitting them (render from
  // `onReady`, remove from an unmount-only cleanup) breaks under React's
  // development double-invoke: on a client-side navigation `onReady` fires
  // inside the first effect pass, the throwaway cleanup then removes the widget
  // that pass created, and `next/script` will not call `onReady` a second time
  // because it guards on a ref that survives the remount. The result is a
  // container with nothing in it and a submit button that can never enable.
  useEffect(() => {
    if (!scriptReady) return;

    const container = containerRef.current;
    if (!container || !TURNSTILE_SITE_KEY || !window.turnstile) {
      setUnavailable(true);
      return;
    }

    const widgetId =
      window.turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: () => {
          // A challenge that succeeds after an earlier failure clears the
          // warning: Turnstile retries network errors on its own, and leaving
          // "could not load" up after a successful retry is just wrong.
          setUnavailable(false);
          onSolvedChangeRef.current(true);
        },
        // The token expired or the interactive challenge timed out. It is no
        // longer redeemable, so the form must close again. `refresh-expired`
        // below means Turnstile starts a fresh one itself, which reopens the
        // gate through `callback` without the visitor doing anything.
        "expired-callback": () => onSolvedChangeRef.current(false),
        "timeout-callback": () => onSolvedChangeRef.current(false),
        // Unlike an expiry, this is a fault: a bad site key, a hostname missing
        // from the widget's allow-list, or a network failure. Say so, rather
        // than repeating "complete the check above" at someone who cannot.
        "error-callback": () => {
          onSolvedChangeRef.current(false);
          setUnavailable(true);
        },
        "refresh-expired": "auto",
      }) ?? null;

    widgetIdRef.current = widgetId;

    return () => {
      widgetIdRef.current = null;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [scriptReady]);

  useEffect(() => {
    if (window.turnstile) return;
    const timer = setTimeout(() => {
      if (!widgetIdRef.current) setUnavailable(true);
    }, SCRIPT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Compared rather than watched by identity alone, so the initial value does
  // not count as a change and reset a widget nobody has touched yet.
  const previousResetKey = useRef(resetKey);
  useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    if (!widgetIdRef.current) return;
    window.turnstile?.reset(widgetIdRef.current);
    onSolvedChangeRef.current(false);
  }, [resetKey]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setUnavailable(true)}
      />
      <div ref={containerRef} />

      {!solved && (
        <p
          id={CAPTCHA_HINT_ID}
          className={`font-body text-xs ${
            unavailable
              ? tone === "dark"
                ? "text-amber-200"
                : "text-amber-900"
              : tone === "dark"
                ? "text-[#f4f4ef]/55"
                : "text-foreground/55"
          }`}
        >
          {unavailable
            ? `The security check could not load, so ${gerund} is not possible right now. Disable any ad or script blocker for this page and reload.`
            : `Complete the check above to ${action}.`}
        </p>
      )}
    </>
  );
}
