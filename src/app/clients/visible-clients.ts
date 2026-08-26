/**
 * F051 — list-shaping logic behind the charity list view, kept out of the route
 * so it can be tested without a database (same split as @/lib/suppressions).
 */

import { z } from "zod";

import {
  PIPELINE_STATUSES,
  formatLocation,
  formatOutreachStatus,
  type PipelineStatus,
} from "../../lib/organisation-format.ts";
import { deriveIncomeBand } from "../settings/outreach-preferences/constants.ts";
import { safeValidate } from "../../lib/validation.ts";

export { formatLocation, formatOutreachStatus };

export type ClientTagRow = { tag_id: string };

export type FinancialPeriodRow = {
  income_band?: string | null;
  total_income?: number | null;
  period_end?: string | null;
};

export type GrantRow = {
  id: string;
  amount_awarded?: number | null;
  funder_name?: string | null;
  award_date?: string | null;
  grant_programme?: string | null;
};

/** F058/F059 — the org's persisted score row (LATEST_SCORES), via the embedded join. */
export type LatestScoreRow = {
  priority_score: number | null;
  priority_band: string | null;
  scored_at: string | null;
};

export type ClientListRow = {
  id: string;
  legal_name: string;
  organisation_type: string;
  city: string | null;
  country_code: string;
  geographic_reach?: string | null;
  sector?: string | null;
  sub_sector?: string | null;
  income_band?: string | null;
  total_income?: number | null;
  financial_periods?: FinancialPeriodRow[] | null;
  grants?: GrantRow[] | null;
  has_grants?: boolean | null;
  latest_scores?: LatestScoreRow | LatestScoreRow[] | null;
  outreach_status: string;
  owner_id: string | null;
  owner: { full_name: string | null } | null;
  org_tags: ClientTagRow[];
};

export type OpenSuppression = { organisation_id: string; status: "pending" | "active" };

export type VisibleClient = ClientListRow & {
  location: string;
  outreachStatusLabel: string;
  suppressionPending: boolean;
  /** F162: null only when owner_id itself is null (genuinely unassigned, claimable).
   * A non-null owner_id whose join came back empty is a deactivated former owner
   * (matrix §1, users_select_active hides their row) — falls back to a label rather
   * than reading as unassigned. */
  ownerName: string | null;
  /** F191/F193: ids of every tag assigned to this client, from the embedded
   * org_tags join. Used by filterByTags below. */
  tagIds: string[];
  income_band: string | null;
  has_grants: boolean;
  /** F058/F059 — the persisted rule-engine score, or null when the client has
   * never been scored (no LATEST_SCORES row yet: newly imported before the
   * rescore hook ran, or a hook failure awaiting the backfill). Null is an
   * explicit state the filter and sort both surface, never a silent zero. */
  priorityScore: number | null;
  priorityBand: "high" | "medium" | "low" | null;
};

/**
 * Resolves the effective income band for an organisation from direct property,
 * latest filed financial period, or numeric total income calculation.
 */
export function resolveClientIncomeBand(org: ClientListRow): string | null {
  if (org.income_band) return org.income_band;

  if (org.financial_periods && org.financial_periods.length > 0) {
    const sorted = [...org.financial_periods].sort((a, b) => {
      const dateA = a.period_end ? new Date(a.period_end).getTime() : 0;
      const dateB = b.period_end ? new Date(b.period_end).getTime() : 0;
      return dateB - dateA;
    });
    const latest = sorted[0];
    if (latest.income_band) return latest.income_band;
    if (latest.total_income !== null && latest.total_income !== undefined) {
      return deriveIncomeBand(latest.total_income);
    }
  }

  if (org.total_income !== null && org.total_income !== undefined) {
    return deriveIncomeBand(org.total_income);
  }

  return null;
}

/**
 * The default list view (F051 AC4): actively suppressed charities (F251) never
 * appear here, regardless of import method or manual entry (F051 AC1). A pending
 * suppression request isn't suppressed yet, so it still shows, flagged.
 */
export function visibleClients(
  organisations: ClientListRow[],
  suppressions: OpenSuppression[],
): VisibleClient[] {
  const statusByOrg = new Map(suppressions.map((row) => [row.organisation_id, row.status]));

  return organisations
    .filter((organisation) => statusByOrg.get(organisation.id) !== "active")
    .map((organisation) => ({
      ...organisation,
      location: formatLocation(organisation),
      outreachStatusLabel: formatOutreachStatus(organisation.outreach_status),
      suppressionPending: statusByOrg.get(organisation.id) === "pending",
      ownerName: organisation.owner_id
        ? (organisation.owner?.full_name ?? "A former team member")
        : null,
      tagIds: (organisation.org_tags ?? []).map((row) => row.tag_id),
      income_band: resolveClientIncomeBand(organisation),
      has_grants: Boolean(
        organisation.has_grants || (organisation.grants && organisation.grants.length > 0),
      ),
      ...latestScoreOf(organisation),
    }));
}

/**
 * F058/F059 — normalises the embedded LATEST_SCORES join into the two fields
 * the list uses. PostgREST returns an object for a to-one join, but defensive
 * normalisation costs one line and means an API-shape surprise degrades to
 * "unscored" rather than crashing every row.
 */
function latestScoreOf(
  organisation: ClientListRow,
): { priorityScore: number | null; priorityBand: "high" | "medium" | "low" | null } {
  const raw = organisation.latest_scores;
  const row = Array.isArray(raw) ? raw[0] : raw;
  const band =
    row?.priority_band === "high" || row?.priority_band === "medium" || row?.priority_band === "low"
      ? row.priority_band
      : null;
  return {
    priorityScore: row?.priority_score ?? null,
    priorityBand: band,
  };
}

/** F163: filters visible clients down to those owned by a specific CAM. */
export function filterByOwner(
  clients: VisibleClient[],
  ownerFilter: string | null | undefined,
): VisibleClient[] {
  if (!ownerFilter) return clients;
  if (ownerFilter === "unassigned") {
    return clients.filter((c) => c.owner_id === null);
  }
  return clients.filter((c) => c.owner_id === ownerFilter);
}

/**
 * F193 — tag filter. OR logic (a client matching ANY selected tag is
 * included), matching the ticket's stated convention for the platform's
 * other multi-select filters. Note: F053/F055/F056, cited by the ticket as
 * the existing pattern to match, do not appear to be built in this codebase
 * yet — this establishes the OR-logic multi-select shape rather than
 * copying an existing implementation.
 */
export function filterByTags(
  clients: VisibleClient[],
  tagFilter: string[] | null | undefined,
): VisibleClient[] {
  if (!tagFilter || tagFilter.length === 0) return clients;
  return clients.filter((client) =>
    client.tagIds.some((tagId) => tagFilter.includes(tagId)),
  );
}

/**
 * F058 — priority-score band filter.
 *
 * The URL carries whole bands, not raw numbers (`?score=high&score=unscored`).
 * That is a deliberate shape, not a shortcut on AC1's "above, below, or within
 * a range": the bands ARE the ranges, cut at the thresholds recorded in
 * MODEL_VERSIONS' SCOUT v1 config and in src/lib/scoring/score-client.ts —
 *   high   >= 0.70
 *   medium >= 0.40
 *   low    <  0.40
 * Selecting `high` alone is "above 0.70"; `low` alone is "below 0.40";
 * `medium` + `high` is "within 0.40–1.0". A union of named ranges covers every
 * case AC1 names while staying inside the same repeated-param multi-select
 * pattern as city/country/status/type — and it reads the persisted
 * `priority_band`, so the page never re-derives cut-offs that could drift from
 * what scoring actually wrote.
 *
 * AC3 — unscored is explicit. A client with no LATEST_SCORES row matches only
 * the `unscored` value: with no selection they stay visible (a missing score
 * must not hide a client from the plain list), but the moment any band is
 * chosen they drop out unless asked for by name. Silently excluding them from
 * every band view would hide exactly the clients whose scores are missing —
 * usually the newest imports, the ones a CAM most needs to see somewhere.
 */
export const PRIORITY_SCORE_FILTERS = [
  { value: "high", label: "High score (0.70+)" },
  { value: "medium", label: "Medium score (0.40–0.69)" },
  { value: "low", label: "Low score (under 0.40)" },
  { value: "unscored", label: "Unscored yet" },
] as const;

export type PriorityScoreFilter = (typeof PRIORITY_SCORE_FILTERS)[number]["value"];

const PRIORITY_SCORE_VALUES = new Set<string>(
  PRIORITY_SCORE_FILTERS.map((entry) => entry.value),
);

/** Labels for chips / saved-view descriptions, keyed by the URL value. */
export function priorityScoreFilterLabel(value: string): string {
  return PRIORITY_SCORE_FILTERS.find((entry) => entry.value === value)?.label ?? value;
}

export function parsePriorityScoreFilter(
  value: string | string[] | null | undefined,
): PriorityScoreFilter[] {
  return filterValues(value).filter((entry): entry is PriorityScoreFilter =>
    PRIORITY_SCORE_VALUES.has(entry),
  );
}

export function filterByPriorityScore(
  clients: VisibleClient[],
  bandFilter: string | string[] | null | undefined,
): VisibleClient[] {
  const wanted = parsePriorityScoreFilter(bandFilter);
  if (wanted.length === 0) return clients;
  const wantUnscored = wanted.includes("unscored");
  const wantedBands = wanted.filter((value): value is Exclude<PriorityScoreFilter, "unscored"> =>
    value !== "unscored",
  );
  return clients.filter((client) => {
    if (client.priorityBand === null) return wantUnscored;
    // A scored client whose band is somehow outside the known vocabulary has no
    // checkbox that could select it — excluded rather than leaking into a band.
    return wantedBands.includes(client.priorityBand);
  });
}

/**
 * Free-text search on the client list. Case-insensitive substring match on
 * legal_name only — the field the list actually displays and the one a CAM
 * would type from memory.
 */
export function searchClients(
  clients: VisibleClient[],
  term: string | null | undefined,
): VisibleClient[] {
  const q = term?.trim().toLowerCase();
  if (!q) return clients;
  return clients.filter((c) => c.legal_name.toLowerCase().includes(q));
}

/**
 * F052 AC3 — the empty list needs to explain itself rather than just showing
 * nothing. A search term takes priority over the F166 owned-view copy: a CAM on
 * "My clients" who searches for something absent was previously told "You don't
 * own any clients yet", which is simply false when they do own some.
 */
export function emptyStateMessage({
  isOwnedView,
  search,
  filterActive,
}: {
  isOwnedView: boolean;
  search?: string | null;
  filterActive: boolean;
}): string {
  const term = search?.trim();
  if (term) {
    return `No clients match “${term}”. Clear the search to see the full list.`;
  }
  if (isOwnedView) {
    return "You don't own any clients yet. Claim one from the list, or ask an admin to assign you one.";
  }
  return filterActive ? "No clients match this filter." : "No clients to show.";
}

/**
 * A filter parameter's selected values. Multi-select writes the parameter more
 * than once (`?city=Leeds&city=York`), which Next hands over as a string[];
 * a single choice is still a plain string. Everything downstream wants the same
 * shape, so normalise once here rather than at each call site.
 *
 * An empty array means "no filter", which is why blank values are dropped: a
 * stray `?city=` should show everything, not nothing.
 */
export function filterValues(
  value: string | string[] | null | undefined,
): string[] {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/**
 * F054 AC1 — city. Multi-select is a union (any of the chosen cities), which is
 * the only reading that makes sense: a client has one city, so treating several
 * as "all of them" would always return nothing.
 */
export function filterByCity(
  clients: VisibleClient[],
  cityFilter: string | string[] | null | undefined,
): VisibleClient[] {
  const wanted = filterValues(cityFilter).map((value) => value.toLowerCase());
  if (wanted.length === 0) return clients;
  return clients.filter((client) => {
    const city = client.city?.toLowerCase();
    return city !== undefined && wanted.includes(city);
  });
}

/**
 * F054 AC1 — country, the level above city. Matches `country_code`, which is
 * never null, so unlike city there is no "missing value" case to think about.
 *
 * Note there is deliberately no *region* filter, the third option AC1 offers:
 * ORGANISATIONS has no region column (only country_code, city and postcode), so
 * a region filter would need a schema change and that is not this ticket's to
 * make. Country plus city satisfies AC2's "at least one level beyond country".
 */
export function filterByCountry(
  clients: VisibleClient[],
  countryFilter: string | string[] | null | undefined,
): VisibleClient[] {
  const wanted = filterValues(countryFilter).map((value) => value.toLowerCase());
  if (wanted.length === 0) return clients;
  return clients.filter((client) => wanted.includes(client.country_code.toLowerCase()));
}

/**
 * F056 — outreach status. AC3: selecting several statuses shows clients in *any*
 * of them.
 *
 * Matches the stored enum value (`not_contacted`), not the formatted label
 * ("Not contacted"). It used to match the label, which meant any link built from
 * a database value — an API response, a seeded fixture, a hand-written URL —
 * silently returned nothing. The label is a display concern and can be
 * retranslated at any time; the enum is the stable identifier, so it is the one
 * the URL carries.
 */
export function filterByStatus(
  clients: VisibleClient[],
  statusFilter: string | string[] | null | undefined,
): VisibleClient[] {
  const wanted = filterValues(statusFilter).map((value) => value.toLowerCase());
  if (wanted.length === 0) return clients;
  return clients.filter((client) => wanted.includes(client.outreach_status.toLowerCase()));
}

/**
 * F053 — organisation type. AC1 asks for the standardised type field and AC2 for
 * a union across several types, so this matches `organisation_type` values
 * (`charity`, `company`, `both`, `other`) directly.
 *
 * It replaces the earlier `filterBySource`, which took display labels
 * ("Charity Commission") and mapped them onto types, treating the field as
 * *which register a record came from* rather than *what kind of organisation it
 * is*. Two consequences of that made it fail its own ACs: "Charity Commission"
 * quietly meant charity-or-dual, so no combination of labels could express the
 * plain union AC2 asks for; and an unrecognised label fell through to
 * `return clients`, so a stale or mistyped filter showed **every** client
 * instead of none — a filter that appears to be off rather than one that
 * matched nothing. An unknown value here simply matches no client.
 */
export function filterByType(
  clients: VisibleClient[],
  typeFilter: string | string[] | null | undefined,
): VisibleClient[] {
  const wanted = filterValues(typeFilter).map((value) => value.toLowerCase());
  if (wanted.length === 0) return clients;
  return clients.filter((client) => wanted.includes(client.organisation_type.toLowerCase()));
}

export type OutreachQueuePreferences = {
  preferred_geographic_reach?: string[] | null;
  preferred_cities?: string[] | null;
  preferred_sectors?: string[] | null;
  preferred_income_bands?: string[] | null;
  prioritise_grant_recipients?: boolean | null;
};

/**
 * The South Yorkshire city set and the expansions below — "regional" reach means
 * South Yorkshire, "local" reach means Sheffield, and both stack with exact city
 * matches (a Sheffield org under a Sheffield-preferring local CAM can reach +30
 * where an exact Leeds match gets +10) — are deliberate pilot scoping:
 * 180Connect currently serves the Sheffield branch only. When another branch
 * onboards this must become region-driven data, not more hardcoded cities.
 */
export type GeographicPreference = OutreachQueuePreferences;

/**
 * The one keyword table for cross-source sector matching (F197) — the settings
 * presets in src/app/settings/outreach-preferences/constants.ts describe sectors
 * to the CAM; this table is how those words match heterogeneous organisation
 * data (Charity Commission cause strings, Companies House SIC descriptions,
 * LLM-classified sector tags). Aliases are deliberately specific and are matched
 * on whole words by `textContains` — broad stems like "social" or "energy" used
 * to drag unrelated groups into each other's matches.
 */
export const CANONICAL_SECTOR_GROUPS: Record<string, string[]> = {
  health: ["health", "healthcare", "medical", "hospital", "clinic", "mental health", "disability", "wellbeing", "social care"],
  education: ["education", "training", "school", "schools", "college", "colleges", "university", "learning", "literacy", "teaching", "skills"],
  environment: ["environment", "conservation", "climate", "sustainability", "wildlife", "animal welfare", "renewable energy"],
  poverty: ["poverty", "food bank", "homeless", "housing", "hardship", "deprivation", "social inclusion"],
  community: ["community development", "youth", "children", "family support", "youth services"],
  arts: ["arts", "culture", "heritage", "museum", "theatre", "sport", "recreation"],
  justice: ["human rights", "justice", "equality", "legal", "international aid", "social enterprise", "enterprise"],
};

/** F055 — the URL value for organisations with no sector recorded. A charity
 * with neither a sector nor a sub-sector must remain reachable under an explicit
 * "Unclassified" option rather than silently disappearing from every sector
 * filter (F055 AC3). */
export const UNCLASSIFIED_SECTOR = "unclassified";

/** Display labels for the filter's URL values — the canonical group keys plus
 * the unclassified sentinel. Saved-view descriptions reuse this map so a view
 * never renders a bare key. */
export const SECTOR_FILTER_LABELS: Record<string, string> = {
  health: "Health",
  education: "Education",
  environment: "Environment & sustainability",
  poverty: "Poverty & hardship",
  community: "Community & youth",
  arts: "Arts, culture & sport",
  justice: "Justice & enterprise",
  [UNCLASSIFIED_SECTOR]: "Unclassified",
};

/** The sector dropdown's options: the canonical taxonomy plus Unclassified,
 * fixed like type/status (not derived from the rows on screen) so a group
 * nobody currently matches never vanishes from the picker. */
export const SECTOR_FILTER_OPTIONS: { label: string; value: string }[] = [
  ...Object.keys(CANONICAL_SECTOR_GROUPS).map((value) => ({
    value,
    label: SECTOR_FILTER_LABELS[value] ?? value,
  })),
  { value: UNCLASSIFIED_SECTOR, label: SECTOR_FILTER_LABELS[UNCLASSIFIED_SECTOR] },
];

/** The text a client's sector is judged on: the standardised sector field plus
 * its sub-sector refinement, lowercased. Both columns are LLM-classified free
 * text (no enum yet), which is why matching goes through the alias table below
 * rather than exact equality. */
function clientSectorText(client: VisibleClient): string {
  return `${(client.sector ?? "").trim()} ${(client.sub_sector ?? "").trim()}`
    .toLowerCase();
}

/**
 * F055 — sector. AC2: selecting several sectors shows charities matching *any*
 * of them (OR logic, same convention as filterByTags/filterByType).
 *
 * The stored `sector`/`sub_sector` values are free text ("Mental Health",
 * "Youth & Children"), so a selection matches through CANONICAL_SECTOR_GROUPS'
 * whole-word aliases rather than exact equality — the same table the queue
 * weighting (getSectorPriorityScore) uses, so filtering and prioritising agree
 * on what "health" means. An unrecognised URL value matches nothing, mirroring
 * filterByType: a stale link narrows visibly rather than showing everything.
 *
 * AC3: a charity with no sector recorded stays reachable — ?sector=unclassified
 * selects exactly those whose sector and sub-sector are both blank.
 */
export function filterBySector(
  clients: VisibleClient[],
  sectorFilter: string | string[] | null | undefined,
): VisibleClient[] {
  const wanted = filterValues(sectorFilter).map((value) => value.toLowerCase());
  if (wanted.length === 0) return clients;
  return clients.filter((client) => {
    const text = clientSectorText(client);
    const classified = text.trim().length > 0;
    return wanted.some((value) => {
      if (value === UNCLASSIFIED_SECTOR) return !classified;
      const aliases = CANONICAL_SECTOR_GROUPS[value];
      // Not a known group: matches nothing rather than everything.
      if (!aliases) return false;
      return (
        textContains(text, value) || aliases.some((alias) => textContains(text, alias))
      );
    });
  });
}

/**
 * Whole-word containment, case-insensitive. Raw `.includes()` matched inside
 * words ("arts" in "parts") and let single-word aliases over-trigger; anchoring
 * on non-alphanumeric boundaries keeps phrase aliases like "mental health"
 * working across "&"-separated strings.
 *
 * Compiled patterns are memoised per needle: the alias table is small and
 * fixed, but filterBySector used to rebuild a RegExp per client × selection ×
 * alias, which is wasted work on large datasets (F055 review). Regexes without
 * the `g` flag are stateless under `.test`, so sharing them is safe — this also
 * speeds up getSectorPriorityScore, which matches through the same helper.
 */
const TEXT_CONTAINS_CACHE = new Map<string, RegExp>();

function textContains(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  let pattern = TEXT_CONTAINS_CACHE.get(needle);
  if (!pattern) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`);
    TEXT_CONTAINS_CACHE.set(needle, pattern);
  }
  return pattern.test(haystack);
}

const SOUTH_YORKSHIRE_CITIES = new Set(["sheffield", "rotherham", "barnsley", "doncaster"]);

/** Computes sector weighting score for a client given CAM sector preferences (F197 / F089). */
function getSectorPriorityScore(client: VisibleClient, preferredSectors: string[]): number {
  if (preferredSectors.length === 0) return 0;

  const clientSector = (client.sector ?? "").toLowerCase().trim();
  const clientSubSector = (client.sub_sector ?? "").toLowerCase().trim();
  const clientText = `${clientSector} ${clientSubSector}`;

  if (!clientText.trim()) return 0;

  let score = 0;

  for (const pref of preferredSectors) {
    const p = pref.toLowerCase().trim();
    if (!p) continue;

    // Direct exact or whole-word match on sector
    if (
      clientSector &&
      (clientSector === p || textContains(p, clientSector) || textContains(clientSector, p))
    ) {
      score = Math.max(score, 10);
      continue;
    }

    if (clientSubSector && (clientSubSector === p || textContains(clientSubSector, p))) {
      score = Math.max(score, 8);
      continue;
    }

    // Canonical category match (e.g. "Health & Social Care" matches "Healthcare")
    for (const [groupKey, groupAliases] of Object.entries(CANONICAL_SECTOR_GROUPS)) {
      const prefMatchesGroup =
        groupAliases.some((alias) => textContains(p, alias)) || textContains(p, groupKey);
      const clientMatchesGroup =
        groupAliases.some((alias) => textContains(clientText, alias)) ||
        textContains(clientText, groupKey);

      if (prefMatchesGroup && clientMatchesGroup) {
        score = Math.max(score, 8);
      }
    }
  }

  return score;
}

/**
 * Computes geographic weighting score for a client given CAM geographic preferences (F196 / F090).
 *
 * The South Yorkshire city set, "regional → South Yorkshire" and "local →
 * Sheffield" expansions are deliberate pilot scoping: 180Connect currently serves
 * the Sheffield branch only, where regional means South Yorkshire and local means
 * Sheffield. When another branch onboards this must become region-driven data,
 * not more hardcoded cities.
 */
function getGeographicPriorityScore(
  client: VisibleClient,
  preferredReach: string[],
  preferredCities: string[],
): number {
  if (preferredReach.length === 0 && preferredCities.length === 0) return 0;

  let score = 0;
  const clientCity = client.city?.toLowerCase().trim();

  const wantsSouthYorkshire =
    preferredCities.some((c) => c === "south yorkshire" || c === "south yorks") ||
    preferredReach.includes("regional");
  const wantsLocalSheffield =
    preferredCities.some((c) => c === "sheffield") || preferredReach.includes("local");

  if (clientCity && preferredCities.includes(clientCity)) {
    score += 10;
  }

  if (clientCity && SOUTH_YORKSHIRE_CITIES.has(clientCity) && wantsSouthYorkshire) {
    score += 8;
  }

  if (clientCity === "sheffield" && wantsLocalSheffield) {
    score += 10;
  }

  if (client.geographic_reach && preferredReach.includes(client.geographic_reach.toLowerCase())) {
    score += 5;
  }

  if (preferredReach.includes("national") && client.country_code === "GB") {
    score += 3;
  }

  return score;
}

/**
 * F197 / F089 / F094 — Personalised CAM queue sector weighting.
 *
 * Re-orders clients so that organisations matching the CAM's preferred sectors
 * are prioritised higher in the CAM's personal queue.
 *
 * A single-dimension view over `prioritiseQueue`: only the sector preference is
 * passed through, so the ordering (and the F094 base-score tie-break) is exactly
 * what the unified queue produces for a CAM whose only active preference is
 * sector. Kept as a named entry point for readability at call sites.
 */
export function prioritiseBySector(
  clients: VisibleClient[],
  preferences?: OutreachQueuePreferences | null,
): VisibleClient[] {
  return prioritiseQueue(clients, {
    preferred_sectors: preferences?.preferred_sectors ?? null,
  });
}

/**
 * Calculates size (income band) priority score for a client against CAM preferences.
 */
export function getSizePriorityScore(
  client: VisibleClient,
  preferredBands: string[],
): number {
  if (preferredBands.length === 0) return 0;
  if (!client.income_band) return 0;

  const clientBand = client.income_band.toLowerCase().trim();
  if (preferredBands.includes(clientBand)) {
    return 10;
  }

  return 0;
}

/**
 * F198 / F091 / F094 — Personalised CAM queue size (income band) weighting.
 *
 * Re-orders clients so that organisations matching the CAM's preferred size tiers
 * are prioritised higher in the CAM's personal queue.
 *
 * A single-dimension view over `prioritiseQueue` (see prioritiseBySector): only
 * the income-band preference is passed through, so ties break on the F094 base
 * score rather than the alphabet.
 */
export function prioritiseBySize(
  clients: VisibleClient[],
  preferences?: OutreachQueuePreferences | null,
): VisibleClient[] {
  return prioritiseQueue(clients, {
    preferred_income_bands: preferences?.preferred_income_bands ?? null,
  });
}

/**
 * Calculates grant / funding history priority score for a client (F199 / F092).
 */
export function getGrantPriorityScore(
  client: VisibleClient,
  prioritiseGrantRecipients?: boolean | null,
): number {
  if (!prioritiseGrantRecipients) return 0;
  return client.has_grants ? 10 : 0;
}

/**
 * F199 / F092 / F094 — Personalised CAM queue grant funding history weighting.
 *
 * Re-orders clients so that organisations with documented grant awards (360Giving)
 * are prioritised higher in the CAM's personal queue.
 *
 * A single-dimension view over `prioritiseQueue` (see prioritiseBySector): only
 * the grant toggle is passed through, so ties break on the F094 base score
 * rather than the alphabet.
 */
export function prioritiseByGrants(
  clients: VisibleClient[],
  preferences?: OutreachQueuePreferences | null,
): VisibleClient[] {
  return prioritiseQueue(clients, {
    prioritise_grant_recipients: preferences?.prioritise_grant_recipients ?? false,
  });
}

/**
 * F196 / F197 / F198 / F199 / F090 / F089 / F091 / F092 / F094 — Unified Personalised CAM Queue Prioritisation.
 *
 * Combines geographic, sector, size, and grant preference weighting to rank matching clients
 * at the top of the CAM's queue without altering underlying base scores (F088).
 *
 * F094 AC1 asks for preferences "layered on top of the base score rather than replacing
 * it" — that is also issue #93's open question ("how personal preferences override base
 * score"), decided as: preference total is the primary key; clients tied on it are ranked
 * by their persisted base score (F088) descending; name breaks remaining ties. Unscored
 * clients are pinned below scored ones within a tie group, in both senses, the same way
 * sortClients treats them for ?listSort=priority — never floating to the top as if
 * unscored meant perfect, nor hiding at the bottom of a tie group as if it meant zero.
 *
 * The persisted scores themselves are only ever read here, never written — changing a
 * preference re-orders the queue on the next view without any re-score (F094 AC3).
 *
 * If no preferences are active (or when cleared), returns the unmodified list in
 * its default unweighted order.
 */
export function prioritiseQueue(
  clients: VisibleClient[],
  preferences?: OutreachQueuePreferences | null,
): VisibleClient[] {
  if (!preferences) return clients;

  const preferredReach = (preferences.preferred_geographic_reach ?? []).map((r) => r.toLowerCase().trim());
  const preferredCities = (preferences.preferred_cities ?? []).map((c) => c.toLowerCase().trim());
  const preferredSectors = (preferences.preferred_sectors ?? []).map((s) => s.toLowerCase().trim());
  const preferredBands = (preferences.preferred_income_bands ?? []).map((b) => b.toLowerCase().trim());
  const prioritiseGrants = Boolean(preferences.prioritise_grant_recipients);

  if (
    preferredReach.length === 0 &&
    preferredCities.length === 0 &&
    preferredSectors.length === 0 &&
    preferredBands.length === 0 &&
    !prioritiseGrants
  ) {
    return clients;
  }

  const byName = (a: VisibleClient, b: VisibleClient) =>
    a.legal_name.localeCompare(b.legal_name);

  return [...clients].sort((a, b) => {
    const geoScoreA = getGeographicPriorityScore(a, preferredReach, preferredCities);
    const geoScoreB = getGeographicPriorityScore(b, preferredReach, preferredCities);
    const secScoreA = getSectorPriorityScore(a, preferredSectors);
    const secScoreB = getSectorPriorityScore(b, preferredSectors);
    const sizeScoreA = getSizePriorityScore(a, preferredBands);
    const sizeScoreB = getSizePriorityScore(b, preferredBands);
    const grantScoreA = getGrantPriorityScore(a, prioritiseGrants);
    const grantScoreB = getGrantPriorityScore(b, prioritiseGrants);

    const totalA = geoScoreA + secScoreA + sizeScoreA + grantScoreA;
    const totalB = geoScoreB + secScoreB + sizeScoreB + grantScoreB;

    if (totalB !== totalA) {
      return totalB - totalA;
    }
    // Tie on preferences: the base score decides. Unscored sits visibly apart,
    // below every scored peer in the tie group, whichever side it is compared from.
    if ((a.priorityScore === null) !== (b.priorityScore === null)) {
      return a.priorityScore === null ? 1 : -1;
    }
    if (a.priorityScore !== null && b.priorityScore !== null && b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    return byName(a, b);
  });
}

/**
 * F196 / F090 / F094 — geographic-only prioritisation, kept as a named entry
 * point now that prioritiseQueue also weighs sector, size and grants. A thin
 * wrapper: preferences carrying only reach and cities produce the same order.
 */
export function prioritiseByGeography(
  clients: VisibleClient[],
  preferences?: GeographicPreference | null,
): VisibleClient[] {
  return prioritiseQueue(clients, preferences);
}

/**
 * F094 — whether a preferences row would actually reorder anything. Same
 * trimming/normalisation `prioritiseQueue` applies internally, so this cannot
 * disagree with it: a row of only whitespace values counts as inactive here
 * and reorders nothing there. The clients page uses it to know when the
 * default view is genuinely a personal queue rather than just unsorted data.
 */
export function hasActiveQueuePreferences(
  preferences?: OutreachQueuePreferences | null,
): boolean {
  if (!preferences) return false;
  const active = (values?: string[] | null) =>
    (values ?? []).some((value) => value.trim().length > 0);
  return (
    active(preferences.preferred_geographic_reach) ||
    active(preferences.preferred_cities) ||
    active(preferences.preferred_sectors) ||
    active(preferences.preferred_income_bands) ||
    Boolean(preferences.prioritise_grant_recipients)
  );
}

/* ─── List sorting (F060 #62, F061 #63) ────────────────────────────────── */

/**
 * The fields the *list* can be sorted on. Deliberately not the same set as the
 * insight band's breakdown (`parseField` in client-insights.ts): that panel
 * groups and counts, this one orders rows. They read from different URL params
 * (`listSort`/`listDir` here, `sort`/`dir` there) so one can be changed without
 * disturbing the other — the two controls are visible on screen at once.
 */
export type ListSortField = "name" | "location" | "status" | "priority";
/** Spelled out rather than asc/desc because the control is a sentence, and the
 * breakdown card next to it already uses these words (client-insights.ts). */
export type ListSortDirection = "ascending" | "descending";

export const LIST_SORT_FIELDS: { key: ListSortField; label: string }[] = [
  { key: "name", label: "name" },
  { key: "location", label: "location" },
  { key: "status", label: "outreach status" },
  { key: "priority", label: "priority score" },
];

export const LIST_SORT_DIRECTIONS: ListSortDirection[] = ["ascending", "descending"];

/** `?listSort=` is user input, so anything unrecognised falls back to the
 * default the list has always used — alphabetical by name, ascending. Parsed
 * through `safeValidate` (`src/lib/validation.ts`) like every other input,
 * rather than hand-rolled comparison. */
const LIST_SORT_FIELD_SCHEMA = z.enum(
  LIST_SORT_FIELDS.map((field) => field.key) as [ListSortField, ...ListSortField[]],
);

const LIST_SORT_DIRECTION_SCHEMA = z.enum(["ascending", "descending"]);

export function parseListSort(value: string | null | undefined): ListSortField {
  const parsed = safeValidate(LIST_SORT_FIELD_SCHEMA, value);
  return parsed.success ? parsed.data : "name";
}

export function parseListDirection(value: string | null | undefined): ListSortDirection {
  const parsed = safeValidate(LIST_SORT_DIRECTION_SCHEMA, value);
  return parsed.success ? parsed.data : "ascending";
}

/**
 * Rank of a status in the pipeline (F061 AC1): its index in PIPELINE_STATUSES,
 * which is the order F145/F146-F155 define, *not* alphabetical order of the
 * label — "Converted" would otherwise sort before "Initial outreach sent".
 * A status not in that list sorts to the end rather than to the front, so a
 * value added to the database before it is added here is visibly last instead
 * of silently leading the list. "Last" holds in *both* directions: the
 * comparator pins unknown ranks below known ones before the direction sign is
 * applied, so a descending sort cannot float an unrecognised status to the top.
 *
 * The order itself, and the reasoning for it, is written down in
 * docs/client-list-sorting.md — F061 AC3 asks for exactly that.
 */
const UNKNOWN_STATUS_RANK = PIPELINE_STATUSES.length;

function pipelineRank(status: string): number {
  const index = PIPELINE_STATUSES.indexOf(status as PipelineStatus);
  return index === -1 ? UNKNOWN_STATUS_RANK : index;
}

/**
 * F060 AC1/AC2 and F061 AC1 — order the list.
 *
 * Applied *after* filtering and *before* pagination, so the sort covers the
 * whole filtered set rather than re-ordering whichever 25 rows page 1 happened
 * to hold (F060 AC3 / F061 AC2: sorting combines with the active filters).
 *
 * Every field tie-breaks on legal_name, ascending, and that tie-break is not
 * reversed by `desc`. Two consequences, both wanted: clients sharing a location
 * stay adjacent *and* in a stable, readable order within the group (F060 AC2),
 * and the same query always produces the same page 2.
 *
 * Returns a new array — the caller's list is left alone, since the unsorted
 * order still feeds the funnel and breakdown counts above the list.
 */
export function sortClients(
  clients: VisibleClient[],
  field: ListSortField,
  direction: ListSortDirection,
): VisibleClient[] {
  const sign = direction === "descending" ? -1 : 1;
  const byName = (a: VisibleClient, b: VisibleClient) =>
    a.legal_name.localeCompare(b.legal_name, "en", { sensitivity: "base" });

  return [...clients].sort((a, b) => {
    let primary = 0;
    if (field === "location") {
      primary = a.location.localeCompare(b.location, "en", { sensitivity: "base" });
    } else if (field === "status") {
      const rankA = pipelineRank(a.outreach_status);
      const rankB = pipelineRank(b.outreach_status);
      // Unknown ranks are pinned last *before* the direction sign is applied —
      // otherwise a descending sort would reverse them to the top, which is the
      // failure mode "visibly last" exists to prevent.
      if ((rankA === UNKNOWN_STATUS_RANK) !== (rankB === UNKNOWN_STATUS_RANK)) {
        return rankA === UNKNOWN_STATUS_RANK ? 1 : -1;
      }
      primary = rankA - rankB;
    } else if (field === "priority") {
      // F059 AC2 — sort on the persisted score. Unscored clients (no
      // LATEST_SCORES row) are pinned last in *both* directions, the same
      // pre-sign pattern as the unknown status rank above: a client we have
      // never scored must not float to the top of "highest first" as if it had
      // a perfect score, nor hide at the bottom of "lowest first" as if scored
      // zero. It sits visibly apart, saying "score me".
      if ((a.priorityScore === null) !== (b.priorityScore === null)) {
        return a.priorityScore === null ? 1 : -1;
      }
      primary =
        a.priorityScore !== null && b.priorityScore !== null
          ? a.priorityScore - b.priorityScore
          : 0;
    } else {
      primary = byName(a, b);
    }
    if (primary !== 0) return primary * sign;
    return field === "name" ? 0 : byName(a, b);
  });
}
