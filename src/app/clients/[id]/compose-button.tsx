"use client";

import { useState } from "react";

/**
 * F050 (#52) placeholder send action — see the comment on ../page.tsx for why this
 * exists ahead of the real F094/F100 outreach UI. Two states, no network call:
 *
 * - blocked: a real, non-dismissable disabled state. The "why" is the Do Not
 *   Contact banner already rendered above this component on the page — this button
 *   doesn't repeat it, just refuses to be clicked.
 * - not blocked: clickable, but clicking only reveals a message saying so. Nothing
 *   is sent, because nothing can be — there is no outreach_messages insert here at
 *   all, real or otherwise.
 */
export function ComposeButton({ blocked }: { blocked: boolean }) {
  const [clicked, setClicked] = useState(false);

  if (blocked) {
    return (
      <div>
        <button
          className="cursor-not-allowed rounded-lg border border-black/10 px-5 py-2.5 font-bold text-foreground/40"
          disabled
          title="Do Not Contact — outreach is blocked for this charity"
          type="button"
        >
          Compose email
        </button>
        <p className="mt-2 text-xs text-foreground/50">
          Blocked — see the Do Not Contact notice above.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        className="rounded-lg border border-black/15 px-5 py-2.5 font-bold hover:bg-black/[0.03]"
        onClick={() => setClicked(true)}
        type="button"
      >
        Compose email
      </button>
      {clicked ? (
        <p aria-live="polite" className="mt-2 text-xs text-foreground/50">
          Email generation isn&apos;t built yet (F094, F100) — this button is a
          placeholder so Do Not Contact protection (F050) can be demonstrated ahead
          of the real send flow.
        </p>
      ) : null}
    </div>
  );
}
