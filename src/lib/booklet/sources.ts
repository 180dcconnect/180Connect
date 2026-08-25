// F087 — Booklet Source References: which sources actually contributed to a
// generation, so a CAM can see what to trust. Derived from the same
// BookletWebsiteContext value build-prompt.ts receives, so "what the CAM sees as a
// source" can never drift from "what was actually sent to the model" (AC1/AC3).
//
// Profile data (organisations + enrichment_results, F083's own field list) is
// unconditional — the route always fetches and sends it, even when a client's
// profile is sparse; a missing field renders as "Not provided" in the prompt
// rather than dropping profile out of it entirely. The website is the only
// conditional source (F084): present only when fetchWebsiteContext actually
// returned usable text, never merely because a URL was typed in (AC3).
//
// "Verified" vs "unverified" (AC2) is about trust, not presence: profile data is
// this CRM's own records (ingested, enriched, or an organisation's own
// submission); a pasted URL is arbitrary external content scraped fresh, on the
// spot, with no verification step of its own.

import type { BookletWebsiteContext } from "./build-prompt.ts";

export type BookletSource =
  | { type: "profile"; verified: true }
  | { type: "website"; verified: false; hostname: string };

/** Authoritative for a fresh generation — call with the exact value passed to buildBookletPrompt. */
export function deriveBookletSources(websiteContext: BookletWebsiteContext): BookletSource[] {
  const sources: BookletSource[] = [{ type: "profile", verified: true }];
  if (websiteContext) {
    sources.push({ type: "website", verified: false, hostname: websiteContext.hostname });
  }
  return sources;
}

/**
 * Reconstructs the same source list for a saved/historical version, where
 * CLIENT_BOOKLETS only stores the used/not-used boolean and the URL, not the
 * scraped text itself. An unparseable stored URL degrades to profile-only rather
 * than throwing — this must never crash the page over old stored data.
 */
export function deriveSourcesFromSavedRow(saved: {
  websiteContextUsed: boolean;
  websiteUrl: string | null;
}): BookletSource[] {
  const sources: BookletSource[] = [{ type: "profile", verified: true }];
  if (saved.websiteContextUsed && saved.websiteUrl) {
    try {
      sources.push({ type: "website", verified: false, hostname: new URL(saved.websiteUrl).hostname });
    } catch {
      // Saved data from before a URL got mangled somehow — fall through to profile-only.
    }
  }
  return sources;
}
