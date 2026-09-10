/**
 * F215 Search by Mission — AC2 (semantic half).
 *
 * The keyword half of mission search (`searchClientsByMission` in
 * src/app/clients/visible-clients.ts) matches whole words, so a CAM who types
 * "helping refugees" only finds charities that use those exact words. This
 * module widens that: it asks Gemini for a handful of *alternative* words and
 * short phrases that mean the same thing ("asylum seekers", "displaced
 * families", "resettlement"), and the list matches a client whose mission uses
 * any of them. Different wording, same underlying meaning — AC2.
 *
 * Deliberately query expansion rather than embeddings: the data half is a
 * single text column on ~2,750 rows, the deployment is two projects on the
 * Supabase free plan (no pgvector budget to spare, no backfill job to babysit),
 * and the codebase already talks to Gemini through the AI SDK. Expansion costs
 * one small call per distinct query, cached below.
 *
 * The contract this module offers its caller is deliberately boring: it never
 * throws, never takes more than its timeout, and on any failure returns
 * `mode: "unavailable"` with no keywords, which the caller reads as "run the
 * plain keyword search and say so". A search page must not fail because its
 * optional widener did.
 */

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";

/** Hard ceiling on the query we will send. The UI's own input caps at the same
 * number, so this is defence in depth against a hand-built URL. */
export const MISSION_QUERY_MAX_LENGTH = 120;

/** Most expanded keywords kept. The prompt asks for 3–8; anything past 10 adds
 * matching cost and widens the net without adding recall. */
export const MISSION_KEYWORDS_MAX = 10;

/** Longest single expanded keyword. The prompt asks for 1–3 words; this caps a
 * runaway model reply so one 200-character "keyword" cannot reach the matcher. */
export const MISSION_KEYWORD_MAX_LENGTH = 40;

/** Free-tier Gemini takes seconds, not tens of seconds, on a prompt this small.
 * A search that widens the filter must not feel slower than the page render it
 * rides; past this the keyword fallback answers instead. */
export const MISSION_EXPANSION_TIMEOUT_MS = 8_000;

/** How long an expansion is reused. Missions drift slowly; a day-old expansion
 * of "climate" is still a good expansion of "climate". */
const EXPANSION_TTL_MS = 24 * 60 * 60 * 1000;

/** A failed or empty expansion is retried this often, not on every render —
 * otherwise one dead API key turns every mission search into an 8s wait. */
const FAILED_EXPANSION_TTL_MS = 5 * 60 * 1000;

const CACHE_MAX_ENTRIES = 200;

/**
 * How the mission filter should run for this query:
 * - `semantic`  — keywords from Gemini are available; matching is
 *                 (query words, AND) OR (any expanded keyword).
 * - `keyword`   — no expansion was needed to be tried yet / expansion returned
 *                 nothing usable; plain keyword matching (AC1).
 * - `unavailable` — Gemini is not configured, was rate-limited, failed, or
 *                 timed out. Same matching as `keyword`; the caller is expected
 *                 to say so in the UI rather than pretend nothing happened.
 */
export type MissionExpansionMode = "semantic" | "keyword" | "unavailable";

export type MissionExpansion = {
  keywords: string[];
  mode: MissionExpansionMode;
};

export type CallMissionQueryModel = (input: { prompt: string }) => Promise<{ text: string }>;

/**
 * Builds the expansion prompt. Pure, so tests can pin exactly what the model is
 * told. The instruction block carries the constraints the parser then enforces:
 * JSON only, a bounded count, short specific terms, and nothing that merely
 * restates the query (the matcher unions the query's own words in anyway).
 */
export function buildMissionQueryPrompt(query: string): string {
  return [
    "You expand a short search phrase into alternative search terms for a database",
    "of UK charities, where each charity has a one-paragraph mission statement",
    "describing the cause it works on.",
    "",
    `Search phrase: "${query}"`,
    "",
    "Return 3 to 8 alternative search terms that a charity mission statement is",
    "likely to use when it describes this same kind of work, even with different",
    "wording. Rules:",
    "- Each term is 1 to 3 ordinary words.",
    "- Terms must be specific to the cause, not generic fillers like",
    '  "charity", "support", "people" or "help".',
    "- Do not repeat words already in the search phrase.",
    '- Reply with JSON only, exactly in this shape: {"keywords": ["term", "term"]}',
  ].join("\n");
}

/**
 * Turns the model's reply into a clean keyword list. Pure and total: garbage in,
 * empty list out, never a throw. Each term is lowercased, stripped to letters,
 * spaces and hyphens, length-capped, deduplicated, and anything that merely
 * restates a word of the original query is dropped (the matcher already ANDs
 * the query's own words — keeping them here would only widen noise).
 */
export function parseMissionQueryExpansion(text: string, query: string): string[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const rawKeywords = (parsed as Record<string, unknown>).keywords;
  if (!Array.isArray(rawKeywords)) return [];

  // Words already in the query, so a keyword that only restates one is dropped.
  const queryWords = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 0),
  );

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const entry of rawKeywords) {
    if (typeof entry !== "string") continue;
    const term = entry
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!term || term.length > MISSION_KEYWORD_MAX_LENGTH) continue;
    // A term made only of stripped-away punctuation collapses to nothing above.
    if (!/[a-z0-9]/.test(term)) continue;
    const words = term.split(" ").filter((word) => word.length > 0);
    // A term whose every word is already in the query adds nothing to match on.
    if (words.every((word) => queryWords.has(word))) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    keywords.push(term);
    if (keywords.length >= MISSION_KEYWORDS_MAX) break;
  }
  return keywords;
}

/**
 * The real model call, shaped exactly like the booklet generator's
 * `realCallGemini`: env read at construction so a missing configuration throws
 * here — where `expandMissionQuery` catches it and degrades — rather than
 * surfacing as an unexpected failure on the model call itself.
 */
export function createMissionQueryModelCall(): { callModel: CallMissionQueryModel; model: string } {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) throw new Error("Gemini generation is not configured.");
  const google = createGoogleGenerativeAI({ apiKey });
  const callModel: CallMissionQueryModel = async ({ prompt }) => {
    const result = await generateText({
      model: google(model),
      prompt,
      timeout: MISSION_EXPANSION_TIMEOUT_MS,
    });
    return { text: result.text };
  };
  return { callModel, model };
}

type CacheEntry = { keywords: string[]; ok: boolean };

type CachedExpansion = CacheEntry & { at: number };

const expansionCache = new Map<string, CachedExpansion>();

function cacheGet(cache: Map<string, CachedExpansion>, key: string, now: number): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  const ttl = entry.ok ? EXPANSION_TTL_MS : FAILED_EXPANSION_TTL_MS;
  if (now - entry.at > ttl) {
    cache.delete(key);
    return null;
  }
  return { keywords: entry.keywords, ok: entry.ok };
}

function cacheSet(cache: Map<string, CachedExpansion>, key: string, entry: CacheEntry, now: number): void {
  // Bound the cache: past 200 entries, drop the oldest (Maps iterate in
  // insertion order). A search page touches a handful of distinct queries.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { ...entry, at: now });
}

export type MissionExpansionDeps = {
  callModel: CallMissionQueryModel;
  model: string;
};

/**
 * Expands one mission query, or explains why it did not. Never throws, never
 * returns more than MISSION_KEYWORDS_MAX keywords.
 *
 * The cache is keyed on the normalised query, so "Climate " and "climate" are
 * one call, not two — a repeated navigation through saved views re-runs the
 * filter without re-running the model. Successes live a day; failures five
 * minutes, so a recovered API starts widening again without a redeploy.
 */
export async function expandMissionQuery(
  query: string,
  deps?: MissionExpansionDeps,
  cache: Map<string, CachedExpansion> = expansionCache,
): Promise<MissionExpansion> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > MISSION_QUERY_MAX_LENGTH) {
    return { keywords: [], mode: "keyword" };
  }

  const cacheKey = trimmed.toLowerCase();
  const now = Date.now();
  const cached = cacheGet(cache, cacheKey, now);
  if (cached) {
    return {
      keywords: cached.keywords,
      // A cached failure stays a failure (with a note), a cached success is
      // semantic. "keyword" here would understate a known-good expansion.
      mode: cached.ok ? "semantic" : "unavailable",
    };
  }

  let deps_ = deps;
  if (!deps_) {
    try {
      deps_ = createMissionQueryModelCall();
    } catch {
      // Not configured: the expected state in a fresh dev environment. Visible
      // through the returned mode (the UI says keyword-only), and deliberately
      // not an ERROR_LOG entry — it is configuration, not a failure.
      cacheSet(cache, cacheKey, { keywords: [], ok: false }, now);
      return { keywords: [], mode: "unavailable" };
    }
  }

  const startedAt = Date.now();
  try {
    const { text } = await deps_.callModel({ prompt: buildMissionQueryPrompt(trimmed) });
    const keywords = parseMissionQueryExpansion(text, trimmed);
    logApiHealth("gemini", "search.mission.expand", true, startedAt, {
      model: deps_.model,
      keyword_count: keywords.length,
    });
    if (keywords.length === 0) {
      // A reply we could not use is still a spent API call: record it as a
      // failure so the retry backoff applies, and let the keyword path answer.
      cacheSet(cache, cacheKey, { keywords: [], ok: false }, now);
      return { keywords: [], mode: "keyword" };
    }
    cacheSet(cache, cacheKey, { keywords, ok: true }, now);
    return { keywords, mode: "semantic" };
  } catch (error) {
    logApiHealth("gemini", "search.mission.expand", false, startedAt, { model: deps_.model });
    // Timeout, quota, 5xx, whatever: the page must still render. Recorded in
    // ERROR_LOG so the failure is visible (DoD), degraded to keyword matching.
    await reportError(error, { operation: "clients.mission_query_expansion" });
    cacheSet(cache, cacheKey, { keywords: [], ok: false }, now);
    return { keywords: [], mode: "unavailable" };
  }
}
