/**
 * Live news hook lookup for Stage 2 follow-ups (F110).
 *
 * A Stage 2 draft may reference one recent, relevant news item about the
 * client charity so the follow-up feels timely. The stored
 * `enrichment_results.news_hooks` are point-in-time LLM output, so this
 * module pulls a fresh candidate at draft-generation time.
 *
 * Provider: Exa (`POST https://api.exa.ai/search`, `category: "news"`).
 * Chosen by bake-off (10 real charities, 2026-09-10, $0.14 over 20 calls):
 * GDELT was trialled first and rejected — its documented "1 req / 5s" limit
 * proved optimistic in practice (sustained 429s from two egresses, ~12s per
 * throttled response, a penalty box no backoff cleared). Gemini grounding
 * would need a Cloud billing account and fuses retrieval into the generation
 * call; Guardian is reliable but single-publisher. Exa measured 0.65–2.2s
 * per lookup at $0.007 a call with a documented 402 `NO_MORE_CREDITS` on
 * exhaustion (blocked, never billed — the £0 guarantee), well inside the
 * 8s budget and the $10/month free allowance at our volume.
 *
 * Fail-open by design (F110 AC2): every failure — disabled provider,
 * unconfigured key, network error, timeout, non-200, malformed payload, no
 * relevant recent article — resolves to `null` so the follow-up generates
 * without a hook instead of failing or, worse, inserting an irrelevant or
 * fabricated item. The prompt already instructs the model to use a hook only
 * when one is supplied and never to invent news.
 *
 * The relevance gate (`selectNewsHook`) is deliberately strict, because the
 * bake-off showed the failure mode is weak hits passing, not misses:
 *
 * - Whole-word token matching: "Assistant … Sheffield" job ads must not
 *   match "Assist Sheffield" ("assist" is a substring of "assistant").
 * - Dual queries: ambiguous names ("Roundabout" the charity vs traffic
 *   infrastructure) are searched shaped as `"Name" charity`, which returned
 *   100% charity coverage where the bare name returned 100% traffic. But
 *   shaping actively harms distinctive names (it drifted "St Luke's Hospice
 *   Sheffield" into LinkedIn staff profiles), so every lookup also runs the
 *   bare name and merges shaped-first — each query covers the other's blind
 *   spot. Single-token names skip the bare results entirely: unshaped
 *   evidence for an ambiguous name is inadmissible.
 * - Domain deprioritisation: the org's own site and social pages rank below
 *   third-party coverage and can only win on a full-phrase match, so a BBC
 *   story beats a LinkedIn page and supplier spam never wins at all.
 * - Author tiers: among equal matches, bylined (real-news) items win over
 *   directory listings and homepages.
 * - Foreign-acronym rejection: an unfamiliar all-caps word (SADACCA vs
 *   SACMHA) is strong evidence of a different entity. The length floor (6)
 *   keeps real-news caps like COVID in play.
 *
 * Known residual (documented, not solved): sister organisations whose names
 * share no rejected acronym but most tokens can still pass. Entity
 * disambiguation is beyond a token gate — the article URL travels with the
 * hook so the CAM verifies it, and the human review checkpoint stays final.
 *
 * Diagnosability (F110 AC3 / F226): both outcomes go through `logApiHealth`
 * and failures additionally through `reportError`. Only counts, statuses and
 * ids are logged — never the query string or article text.
 *
 * Nothing is stored: the hook text travels in the generation prompt (which
 * F112 already persists verbatim on ai_generations) and the article URL is
 * returned alongside so the CAM can verify it, adding no rows and no bytes
 * against the 500 MB budget.
 */

import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";

export const NEWS_HOOK_SERVICE = "exa";
export const NEWS_HOOK_OPERATION = "outreach.news_hook.lookup";

export const NEWS_HOOK_PROVIDERS = ["none", "exa"] as const;
export type NewsHookProvider = (typeof NEWS_HOOK_PROVIDERS)[number];

const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";
/** Well inside the route's 60s maxDuration (bake-off p-max was 2.2s). */
const LOOKUP_TIMEOUT_MS = 8_000;
const NUM_RESULTS = 5;
/** `fast` matched `auto` on hook quality in the bake-off at ~40% lower latency. */
const SEARCH_TYPE = "fast";
/** Matches the `startPublishedDate` window sent with every lookup. */
const RECENCY_DAYS = 90;
/** Longest prompt-ready hook kept verbatim; anything longer is truncated. */
export const MAX_HOOK_CHARS = 280;

/** Legal suffixes stripped before phrase-searching, so "X LIMITED" matches "X". */
const LEGAL_SUFFIXES = new Set([
  "limited",
  "ltd",
  "plc",
  "cic",
  "cio",
  "inc",
  "incorporated",
  "llp",
  "lbg",
]);

/**
 * Generic words that must not count as relevance evidence on their own — an
 * article mentioning only "charity" and "trust" is about the sector, not
 * about this client.
 */
const GENERIC_WORDS = new Set([
  ...LEGAL_SUFFIXES,
  "charity",
  "charities",
  "charitable",
  "trust",
  "trusts",
  "foundation",
  "foundations",
  "association",
  "associations",
  "organisation",
  "organization",
  "community",
  "communities",
  "group",
  "groups",
  "network",
  "networks",
  "project",
  "projects",
  "fund",
  "funds",
  "service",
  "services",
  "support",
  "appeal",
  "uk",
  "british",
  "national",
  "royal",
]);

/** Own-site and social hits are coverage of last resort, never the hook. */
const DEPRIORITISED_BASE_DOMAINS = new Set([
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
]);

/** All-caps words at or above this length are treated as entity acronyms. */
const FOREIGN_ACRONYM_MIN_LEN = 6;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type LiveNewsInput = {
  organisationId?: string;
  organisationName: string;
  tradingName?: string | null;
  website?: string | null;
};

export type LiveNewsHook = {
  /** Prompt-ready one-liner: title plus outlet and date, no URL. */
  text: string;
  /** The article URL for the CAM to verify, or null when unusable. */
  url: string | null;
};

/** Provider-agnostic article shape — Exa's response already looks like this. */
export type NewsArticle = {
  title?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  author?: unknown;
};

/**
 * Reads the news-hook provider flag. Unknown or absent values fail closed to
 * "none": an unrecognised provider must disable the lookup, never guess one.
 */
export function resolveNewsProvider(
  source: Record<string, string | undefined> = process.env,
): NewsHookProvider {
  const value = source.NEWS_HOOK_PROVIDER?.trim();
  return (NEWS_HOOK_PROVIDERS as readonly string[]).includes(value ?? "")
    ? (value as NewsHookProvider)
    : "none";
}

/** Collapses a name to the searchable phrase: no legal suffix, no punctuation. */
function searchablePhrase(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9\s'&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  // Pop legal suffixes even down to zero words: a name that is only a legal
  // suffix ("Ltd") has nothing searchable, and querying it matches noise.
  while (words.length > 0 && LEGAL_SUFFIXES.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(" ").slice(0, 100);
}

/**
 * Builds the shaped Exa `query` for an organisation, or null when the name
 * has nothing searchable. The quoted phrase is the precision anchor;
 * "charity" disambiguates common-word names for Exa's neural search
 * (ablation: bare "Roundabout" returned 100% traffic articles, shaped 100%
 * charity coverage). The title gate below remains the enforcer — shaping
 * only improves the candidate pool.
 */
export function buildNewsQuery(name: string): string | null {
  const phrase = searchablePhrase(name);
  if (!phrase) return null;
  return `"${phrase}" charity`;
}

/** Candidate names, everyday (trading) name first per NAME_RULE. */
function candidateNames(input: LiveNewsInput): string[] {
  const names = [input.tradingName, input.organisationName]
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name));
  return Array.from(new Set(names));
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distinctive tokens: long enough to mean something, generic words excluded. */
function significantTokens(name: string): string[] {
  return normalise(searchablePhrase(name))
    .split(" ")
    .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word));
}

/** Full-phrase contiguous match on the normalised title. */
function titleMatchesPhrase(titleHaystack: string, name: string): boolean {
  const phrase = normalise(searchablePhrase(name));
  return Boolean(phrase) && titleHaystack.includes(phrase);
}

/**
 * Token match on whole words only — never substrings. "assist" must not
 * match "assistant" (the Assist Sheffield job-ads failure), so the haystack
 * is compared as a word set rather than with `includes`.
 *
 * Requires the full set when the name has fewer than two distinctive tokens,
 * otherwise at least two. Names with no distinctive tokens at all can only
 * match by phrase, so a generic-only name never matches a random article.
 */
function titleMatchesTokens(titleWords: Set<string>, name: string): boolean {
  const tokens = significantTokens(name);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((token) => titleWords.has(token)).length;
  return hits >= Math.min(2, tokens.length);
}

/** Parses Exa's `publishedDate` (`YYYY-MM-DD`, possibly a full timestamp). */
function parsePublishedDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isRecent(publishedMs: number | null, nowMs: number): boolean {
  // Unparseable/missing dates defer to the server-side `startPublishedDate`
  // bound rather than silently disabling the feature on a format change.
  if (publishedMs === null) return true;
  return publishedMs <= nowMs + 86_400_000 && nowMs - publishedMs <= RECENCY_DAYS * 86_400_000;
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function siteHost(website: string | null | undefined): string | null {
  if (!website?.trim()) return null;
  const withScheme = /:\/\//.test(website) ? website : `https://${website}`;
  return hostnameOf(withScheme);
}

/** True for the org's own domain and social pages — hooks of last resort. */
function isDeprioritised(host: string | null, ownHost: string | null): boolean {
  if (!host) return true;
  if (ownHost && (host === ownHost || host.endsWith(`.${ownHost}`))) return true;
  for (const base of DEPRIORITISED_BASE_DOMAINS) {
    if (host === base || host.endsWith(`.${base}`)) return true;
  }
  return false;
}

function formatDate(publishedMs: number | null): string | null {
  if (publishedMs === null) return null;
  const date = new Date(publishedMs);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** `Title (outlet, Month Year)` — attribution lets the CAM verify the hook. */
function formatHook(title: string, host: string | null, publishedMs: number | null): string {
  const attribution = [host, formatDate(publishedMs)].filter(Boolean).join(", ");
  const suffix = attribution ? ` (${attribution})` : "";
  const room = MAX_HOOK_CHARS - suffix.length;
  const clipped = title.length > room ? `${title.slice(0, Math.max(0, room - 1)).trimEnd()}…` : title;
  return `${clipped}${suffix}`;
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

type ScoredArticle = {
  article: NewsArticle;
  title: string;
  haystack: string;
  titleWords: Set<string>;
  url: string;
  host: string | null;
  publishedMs: number | null;
  hasAuthor: boolean;
  deprioritised: boolean;
};

function scoreArticle(
  article: NewsArticle,
  ownHost: string | null,
): ScoredArticle | null {
  const title = cleanText(article.title);
  const url = cleanUrl(article.url);
  if (!title || !url) return null;
  const host = hostnameOf(url);
  const author = cleanText(article.author);
  const haystack = normalise(title);
  return {
    article,
    title,
    haystack,
    titleWords: new Set(haystack.split(" ").filter(Boolean)),
    url,
    host,
    publishedMs: parsePublishedDate(article.publishedDate),
    hasAuthor: author.length > 0,
    deprioritised: isDeprioritised(host, ownHost),
  };
}

/**
 * All-caps words in the title (of acronym length) that match none of the
 * candidate names — strong evidence of a different entity. Caught the live
 * SADACCA-vs-SACMHA near-miss. The length floor keeps real-news caps like
 * COVID in play; BBC/NHS/MP are shorter still.
 */
function hasForeignAcronym(item: ScoredArticle, namePhrases: string[]): boolean {
  const pattern = new RegExp(`^[A-Z]{${FOREIGN_ACRONYM_MIN_LEN},}$`);
  const acronyms = item.title.split(/[^A-Za-z]+/).filter((word) => pattern.test(word));
  return acronyms.some(
    (acronym) =>
      !namePhrases.some((phrase) => phrase.includes(acronym.toLowerCase())),
  );
}

/**
 * Picks the best hook from provider results. Pure and provider-agnostic, so
 * bake-offs can run real payloads through the production gate.
 *
 * Wrong-entity items (foreign acronym) are removed first. Preferred
 * (third-party) items are considered before deprioritised (own-site/social)
 * ones, and deprioritised items can only win on a full-phrase match — a
 * supplier's LinkedIn post that merely shares tokens never wins. Within each
 * pool, full-phrase matches beat token matches, and bylined items beat
 * unattributed ones. The first recent item in the winning round is returned;
 * anything else resolves to `null`.
 */
export function selectNewsHook(
  articles: NewsArticle[],
  names: string[],
  options: { website?: string | null; nowMs?: number } = {},
): LiveNewsHook | null {
  const nowMs = options.nowMs ?? Date.now();
  const ownHost = siteHost(options.website);
  const namePhrases = names
    .map((name) => normalise(searchablePhrase(name)))
    .filter(Boolean);
  const scored = articles
    .map((article) => scoreArticle(article, ownHost))
    .filter((item): item is ScoredArticle => item !== null)
    .filter((item) => !hasForeignAcronym(item, namePhrases));
  const preferred = scored.filter((item) => !item.deprioritised);
  const deprioritised = scored.filter((item) => item.deprioritised);
  const everything = [...preferred, ...deprioritised];

  const rounds: Array<{ pool: ScoredArticle[]; test: (item: ScoredArticle) => boolean }> = [
    {
      pool: everything,
      test: (item) =>
        item.hasAuthor && names.some((name) => titleMatchesPhrase(item.haystack, name)),
    },
    {
      pool: everything,
      test: (item) => names.some((name) => titleMatchesPhrase(item.haystack, name)),
    },
    {
      pool: preferred,
      test: (item) =>
        item.hasAuthor && names.some((name) => titleMatchesTokens(item.titleWords, name)),
    },
    {
      pool: preferred,
      test: (item) => names.some((name) => titleMatchesTokens(item.titleWords, name)),
    },
  ];

  for (const round of rounds) {
    const match = round.pool.find((item) => round.test(item) && isRecent(item.publishedMs, nowMs));
    if (match) {
      return { text: formatHook(match.title, match.host, match.publishedMs), url: match.url };
    }
  }
  return null;
}

function readResults(json: unknown): NewsArticle[] {
  if (typeof json !== "object" || json === null) return [];
  const results = (json as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];
  return results.filter(
    (result): result is NewsArticle => typeof result === "object" && result !== null,
  );
}

type SearchOutcome =
  | { ok: true; articles: NewsArticle[] }
  | { ok: false; status: number | null };

async function runSearch(
  fetchFn: typeof fetch,
  apiKey: string,
  query: string,
  startedAt: number,
): Promise<SearchOutcome> {
  let response: Response;
  try {
    response = await fetchFn(EXA_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      // No `contents`: title/url/date/author is everything the gate needs,
      // and content extraction would multiply the per-lookup cost.
      body: JSON.stringify({
        query,
        type: SEARCH_TYPE,
        category: "news",
        numResults: NUM_RESULTS,
        startPublishedDate: startPublishedDate(startedAt),
      }),
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: null };
  }
  if (!response.ok) return { ok: false, status: response.status };
  try {
    return { ok: true, articles: readResults((await response.json()) as unknown) };
  } catch {
    return { ok: false, status: null };
  }
}

function failureReason(status: number | null): string {
  // 402 is Exa's documented `NO_MORE_CREDITS`: the free allowance is spent
  // and requests are blocked, never billed. Distinguished from a provider
  // outage so the fix (wait for the monthly reset) is obvious.
  if (status === 402) return "credits_exhausted";
  if (status === 429) return "rate_limited";
  if (status === null) return "lookup_failed";
  return "provider_error";
}
function startPublishedDate(nowMs: number): string {
  const date = new Date(nowMs - RECENCY_DAYS * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Looks up one recent, relevant news item about the organisation via Exa.
 *
 * Never throws and never returns an irrelevant item: any failure or miss
 * resolves to `null` so the caller generates the follow-up without a hook.
 * Both outcomes are logged for F226 diagnosability; only counts, statuses
 * and ids — never the query or article text.
 */
export async function lookupLiveNewsHook(
  input: LiveNewsInput,
  fetchFn: typeof fetch = fetch,
): Promise<LiveNewsHook | null> {
  const startedAt = Date.now();
  const context = { operation: NEWS_HOOK_OPERATION, organisationId: input.organisationId };

  if (resolveNewsProvider() === "none") return null;

  const names = candidateNames(input);
  const queryName = names[0];
  const query = queryName ? buildNewsQuery(queryName) : null;
  if (!query) {
    logApiHealth(NEWS_HOOK_SERVICE, NEWS_HOOK_OPERATION, true, startedAt, {
      organisationId: input.organisationId,
      resultCount: 0,
      matched: false,
    });
    return null;
  }

  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) {
    // A config state, not an error event: the startup group-check refuses a
    // deployment that selects the exa provider without a key, so reaching
    // here means local/dev. Logged (ok:false) for diagnosability, not
    // reported, so every generation does not file an error.
    logApiHealth(NEWS_HOOK_SERVICE, NEWS_HOOK_OPERATION, false, startedAt, {
      organisationId: input.organisationId,
      reason: "not_configured",
    });
    return null;
  }

  try {
    // Dual queries, run together: the shaped query disambiguates common-word
    // names (bare "Roundabout" returns traffic articles), while the bare name
    // covers the shaping drift observed on distinctive names (shaped "St
    // Luke's Hospice Sheffield" returned LinkedIn profiles instead of the
    // BBC coverage the bare name finds). Shaped results merge first so each
    // query covers the other's blind spot. Single-token names skip the bare
    // results entirely: unshaped evidence for an ambiguous name is
    // inadmissible, since the gate cannot tell traffic from charity.
    // `runSearch` never throws, so one failed call still leaves the other's
    // results usable.
    const bareAllowed = significantTokens(queryName).length >= 2;
    const queries = bareAllowed ? [query, queryName] : [query];
    const outcomes = await Promise.all(
      queries.map((text) => runSearch(fetchFn, apiKey, text, startedAt)),
    );
    const failed = outcomes.filter(
      (outcome): outcome is { ok: false; status: number | null } => !outcome.ok,
    );
    const results = outcomes.flatMap((outcome) =>
      outcome.ok ? outcome.articles : [],
    );

    if (failed.length === outcomes.length) {
      const status = failed[0]?.status ?? null;
      const reason = failureReason(status);
      logApiHealth(NEWS_HOOK_SERVICE, NEWS_HOOK_OPERATION, false, startedAt, {
        organisationId: input.organisationId,
        status: status ?? undefined,
        reason,
        resultCount: 0,
      });
      await reportError(
        new Error(
          status === null ? "News lookup failed." : `News lookup returned ${status}.`,
        ),
        { ...context, status: status ?? undefined, reason },
      );
      return null;
    }
    if (failed.length > 0) {
      // Degraded, not dead: record the partial failure once, then gate
      // whatever the surviving call returned.
      const status = failed[0]?.status ?? null;
      await reportError(
        new Error("News lookup partially failed; gating partial results."),
        { ...context, status: status ?? undefined, reason: failureReason(status) },
      );
    }
    const match = selectNewsHook(results, names, { website: input.website });
    logApiHealth(NEWS_HOOK_SERVICE, NEWS_HOOK_OPERATION, true, startedAt, {
      organisationId: input.organisationId,
      resultCount: results.length,
      matched: match !== null,
      partial: failed.length > 0,
    });
    return match;
  } catch (error) {
    logApiHealth(NEWS_HOOK_SERVICE, NEWS_HOOK_OPERATION, false, startedAt, {
      organisationId: input.organisationId,
    });
    await reportError(error, context);
    return null;
  }
}
