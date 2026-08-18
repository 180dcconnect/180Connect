"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";

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
        <OriginButton
          variant="outline"
          size="sm"
          disabled
          title="Do Not Contact — outreach is blocked for this charity"
          type="button"
        >
          Compose email
        </OriginButton>
        <p className="mt-2.5 text-[13px] leading-[1.6] text-foreground/45">
          Blocked — see the Do Not Contact notice above.
        </p>
      </div>
    );
  }

  return (
    <div>
      <OriginButton
        variant="outline"
        size="sm"
        onClick={() => setClicked(true)}
        type="button"
      >
        Compose email
      </OriginButton>
      {clicked ? (
        <p aria-live="polite" className="mt-2.5 text-[13px] leading-[1.6] text-foreground/45">
          Email generation isn&apos;t built yet (F094, F100) — this button is a
          placeholder so Do Not Contact protection (F050) can be demonstrated ahead
          of the real send flow.
        </p>
      ) : null}
    </div>
  );
}
