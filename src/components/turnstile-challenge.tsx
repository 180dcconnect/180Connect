"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

/**
 * The Cloudflare Turnstile widget (F003), shared by every unauthenticated form
 * that needs one.
 *
 * It lives here rather than in a single form because the callbacks below are
 * *global*: Turnstile's implicit rendering looks its handlers up by name on
 * `window`, so two components that each declared their own would fight over the
 * same three names. One widget, one set of handlers, any number of callers.
 *
 * The site key is public by design — it identifies the widget, and only the
 * paired secret (held by Supabase) can validate a token. Read as a static
 * property so Next inlines it into the browser bundle; there is no fallback on
 * purpose, because a wrong-but-present key fails in confusing ways.
 * `src/lib/env.ts` requires it, so a missing key stops the server at startup.
 */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/** The subset of the Turnstile browser API this component uses. */
declare global {
  interface Window {
    turnstile?: { reset: (widget?: string | HTMLElement) => void };
    onTurnstileSolved?: () => void;
    onTurnstileCleared?: () => void;
  }
}

/** Id of the hint paragraph, for the submit button's `aria-describedby`. */
export const CAPTCHA_HINT_ID = "captcha-hint";

export function TurnstileChallenge({
  solved,
  onSolvedChange,
  action,
  gerund,
}: {
  solved: boolean;
  onSolvedChange: (solved: boolean) => void;
  /** What the check gates, as a bare verb phrase: "log in". */
  action: string;
  /** The same thing as a gerund, for the failure sentence: "logging in". */
  gerund: string;
}) {
  // Set when the Turnstile script itself cannot load — blocked by a network
  // filter, an ad blocker, or an outage. Without this the user sees a hint
  // pointing at a widget that never rendered.
  const [challengeUnavailable, setChallengeUnavailable] = useState(false);

  // Turnstile invokes these by name off `window` (see the declaration above).
  useEffect(() => {
    window.onTurnstileSolved = () => onSolvedChange(true);
    // Fires when the token expires or the challenge errors: it is no longer
    // redeemable, so the form must close again.
    window.onTurnstileCleared = () => onSolvedChange(false);
    return () => {
      delete window.onTurnstileSolved;
      delete window.onTurnstileCleared;
    };
  }, [onSolvedChange]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
        onError={() => setChallengeUnavailable(true)}
      />
      <div
        className="cf-turnstile"
        data-sitekey={TURNSTILE_SITE_KEY}
        data-callback="onTurnstileSolved"
        data-expired-callback="onTurnstileCleared"
        data-error-callback="onTurnstileCleared"
        data-timeout-callback="onTurnstileCleared"
      />

      {!solved && (
        <p
          id={CAPTCHA_HINT_ID}
          className={`text-xs ${challengeUnavailable ? "text-amber-900" : "text-foreground/55"}`}
        >
          {challengeUnavailable
            ? `The security check could not load, so ${gerund} is not possible right now. Disable any ad or script blocker for this page and reload.`
            : `Complete the check above to ${action}.`}
        </p>
      )}
    </>
  );
}
