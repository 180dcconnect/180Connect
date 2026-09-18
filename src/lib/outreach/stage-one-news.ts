/**
 * The news hook for a first-contact email.
 *
 * Until now the "Relevant news hook" opening did nothing. The instruction was
 * wired (`OPENING_INSTRUCTIONS.news_hook` in stage-one-prompt.ts) and read
 * `enrichment_results.news_hooks`, but nothing in the app has ever written that
 * column — every reference to it is a read, and both staging and production
 * hold zero non-null values. So the opening always fell through its own "if no
 * news hook is supplied, fall back to a mission-led opening" clause and a CAM
 * who picked it got the default email. F110 built a working live lookup, but
 * wired it only into Stage 2.
 *
 * This is the Stage 1 half of that. Same provider, same gate, same fail-open
 * contract — the only difference is when it runs:
 *
 * **Only when the CAM asked for it.** Stage 2 looks up on every draft, because
 * a follow-up always wants a reason to reconnect. A first email has three other
 * openings and two of them are the common case, so a lookup on every Stage 1
 * draft would bill for hooks that the prompt would then be told to ignore. The
 * opening dial is the switch.
 *
 * Everything else mirrors the Stage 2 route: a live hit beats the (empty)
 * stored hooks, and the article URL rides along on a `Source:` line so it
 * persists verbatim in `ai_generations.prompt_user` (F112) and can be written
 * to the draft row for the review UI.
 */

import { lookupLiveNewsHook, type LiveNewsHook, type LiveNewsInput } from "./news-hook.ts";
import type { OpeningApproach } from "./stage-one-prompt.ts";

export type StageOneNews = {
  /** What the prompt receives as `newsHooks`. Empty when there is no hook. */
  hooks: string[];
  /** The live hit, for the three draft-row columns. Null unless one was found. */
  live: LiveNewsHook | null;
  /** Mirrors the Stage 2 route's own vocabulary for the same three states. */
  source: "live" | "stored" | "none";
};

/**
 * Composes the prompt-ready hook list, running a live lookup only when the
 * chosen opening is the one that uses it.
 *
 * Never throws: `lookupLiveNewsHook` resolves to null on every failure — no
 * provider, no key, timeout, non-200, no relevant article — so a draft is never
 * blocked or delayed past the lookup's own 8s ceiling by a news miss.
 */
export async function resolveStageOneNews(
  input: {
    opening: OpeningApproach;
    organisationId: string;
    organisationName: string;
    tradingName?: string | null;
    website?: string | null;
    city?: string | null;
    countryCode?: string | null;
    geographicReach?: string | null;
    sector?: string | null;
    storedHooks?: string[] | null;
  },
  /**
   * The lookup itself, injected so the *when* can be tested without a network
   * call — the same seam `CallStageOneModel` and `ModelPricingLookup` use. The
   * gate's own behaviour is covered in news-hook.test.ts.
   */
  lookup: (input: LiveNewsInput) => Promise<LiveNewsHook | null> = lookupLiveNewsHook,
): Promise<StageOneNews> {
  const stored = input.storedHooks?.filter(Boolean) ?? [];

  if (input.opening !== "news_hook") {
    // The prompt still receives whatever is stored, exactly as before, so a
    // mission-led draft for an organisation that somehow has stored hooks is
    // unchanged by this feature.
    return { hooks: stored, live: null, source: stored.length > 0 ? "stored" : "none" };
  }

  const live = await lookup({
    organisationId: input.organisationId,
    organisationName: input.organisationName,
    tradingName: input.tradingName,
    website: input.website,
    city: input.city,
    countryCode: input.countryCode,
    geographicReach: input.geographicReach,
    sector: input.sector,
  });
  if (!live) return { hooks: stored, live: null, source: stored.length > 0 ? "stored" : "none" };

  return { hooks: [composeHookText(live)], live, source: "live" };
}

/**
 * Hook text plus its `Source:` line, the shape the Stage 2 route persists.
 *
 * The URL is part of the prompt rather than kept beside it because
 * `ai_generations.prompt_user` is the only place a generation's inputs survive
 * in full — a URL held only in the response is unverifiable the moment the
 * draft is reopened. A model that quotes the source in the draft is acceptable:
 * a CAM reads every word before it sends.
 */
export function composeHookText(live: LiveNewsHook): string {
  return live.url ? `${live.text}\nSource: ${live.url}` : live.text;
}
