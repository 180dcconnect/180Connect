// F214 — Natural Language Charity Search (#209): a small in-process cache of
// query → plan.
//
// The same interpretation gets asked for far more often than a CAM types: every
// page of results re-renders the server component, so paginating a search
// without this would buy the identical plan again on page 2, 3 and 4. Common
// queries ("charities in Leeds we haven't contacted") also repeat across the
// team and across days.
//
// In memory rather than in Postgres, deliberately. The 500 MB database budget
// (AGENTS.md) is the binding constraint on this project and a cache is exactly
// the kind of write-per-search table that eats it; a plan is also cheap enough
// to re-buy that durability is not worth a row. A cold instance simply pays
// $0.0006 again.
//
// TTL, not just capacity: the vocabulary a plan is validated against changes
// when sectors or statuses do, and an hour is short enough that a stale plan
// never outlives a deploy by long.

import type { NlSearchPlan } from "./nl-search-plan.ts";

const MAX_ENTRIES = 500;
const TTL_MS = 60 * 60 * 1000;

type Entry = { plan: NlSearchPlan; expiresAt: number };

const cache = new Map<string, Entry>();

export function getCachedPlan(key: string, now: number = Date.now()): NlSearchPlan | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  // Re-inserting moves the key to the end of Map's insertion order, which is
  // what makes the eviction below least-recently-*used* rather than oldest-first.
  cache.delete(key);
  cache.set(key, entry);
  return entry.plan;
}

export function setCachedPlan(key: string, plan: NlSearchPlan, now: number = Date.now()): void {
  cache.delete(key);
  cache.set(key, { plan, expiresAt: now + TTL_MS });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Tests only — module state would otherwise leak between cases. */
export function clearPlanCache(): void {
  cache.clear();
}
