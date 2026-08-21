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
    }));
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

/** F054: filter clients by city. */
export function filterByCity(
  clients: VisibleClient[],
  cityFilter: string | null | undefined,
): VisibleClient[] {
  if (!cityFilter) return clients;
  const term = cityFilter.trim().toLowerCase();
  return clients.filter((c) => (c.city ?? "").trim().toLowerCase() === term);
}

/** F056: filter clients by pipeline outreach status. */
export function filterByStatus(
  clients: VisibleClient[],
  statusFilter: string | null | undefined,
): VisibleClient[] {
  if (!statusFilter) return clients;
  const term = statusFilter.trim().toLowerCase();
  return clients.filter((c) => c.outreachStatusLabel.toLowerCase() === term);
}

/** F052: filter clients by source / registration authority. */
export function filterBySource(
  clients: VisibleClient[],
  sourceFilter: string | null | undefined,
): VisibleClient[] {
  if (!sourceFilter) return clients;
  const term = sourceFilter.toLowerCase();
  
  if (term === "companies house") {
    return clients.filter((c) => c.organisation_type === "company" || c.organisation_type === "both");
  }
  if (term === "charity commission") {
    return clients.filter((c) => c.organisation_type === "charity" || c.organisation_type === "both");
  }
  if (term === "dual-registered") {
    return clients.filter((c) => c.organisation_type === "both");
  }
  if (term === "other") {
    return clients.filter((c) => c.organisation_type === "other");
  }
  
  return clients;
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
  education: ["education", "training", "school", "college", "university", "learning", "literacy", "teaching", "skills"],
  environment: ["environment", "conservation", "climate", "sustainability", "wildlife", "animal welfare", "renewable energy"],
  poverty: ["poverty", "food bank", "homeless", "housing", "hardship", "deprivation", "social inclusion"],
  community: ["community development", "youth", "children", "family support", "youth services"],
  arts: ["arts", "culture", "heritage", "museum", "theatre", "sport", "recreation"],
  justice: ["human rights", "justice", "equality", "legal", "international aid", "social enterprise", "enterprise"],
};

/**
 * Whole-word containment, case-insensitive. Raw `.includes()` matched inside
 * words ("arts" in "parts") and let single-word aliases over-trigger; anchoring
 * on non-alphanumeric boundaries keeps phrase aliases like "mental health"
 * working across "&"-separated strings.
 */
function textContains(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(haystack);
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
 */
export function prioritiseBySector(
  clients: VisibleClient[],
  preferences?: OutreachQueuePreferences | null,
): VisibleClient[] {
  if (!preferences) return clients;

  const preferredSectors = (preferences.preferred_sectors ?? []).map((s) => s.toLowerCase().trim());
  if (preferredSectors.length === 0) return clients;

  return [...clients].sort((a, b) => {
    const scoreA = getSectorPriorityScore(a, preferredSectors);
    const scoreB = getSectorPriorityScore(b, preferredSectors);
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return a.legal_name.localeCompare(b.legal_name);
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
 */
export function prioritiseBySize(
  clients: VisibleClient[],
  preferences?: OutreachQueuePreferences | null,
): VisibleClient[] {
  if (!preferences) return clients;

  const preferredBands = (preferences.preferred_income_bands ?? []).map((b) => b.toLowerCase().trim());
  if (preferredBands.length === 0) return clients;

  return [...clients].sort((a, b) => {
    const scoreA = getSizePriorityScore(a, preferredBands);
    const scoreB = getSizePriorityScore(b, preferredBands);
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return a.legal_name.localeCompare(b.legal_name);
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
 */
export function prioritiseByGrants(
  clients: VisibleClient[],
  preferences?: OutreachQueuePreferences | null,
): VisibleClient[] {
  if (!preferences?.prioritise_grant_recipients) return clients;

  return [...clients].sort((a, b) => {
    const scoreA = getGrantPriorityScore(a, preferences.prioritise_grant_recipients);
    const scoreB = getGrantPriorityScore(b, preferences.prioritise_grant_recipients);
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return a.legal_name.localeCompare(b.legal_name);
  });
}

/**
 * F196 / F197 / F198 / F199 / F090 / F089 / F091 / F092 / F094 — Unified Personalised CAM Queue Prioritisation.
 *
 * Combines geographic, sector, size, and grant preference weighting to rank matching clients
 * at the top of the CAM's queue without altering underlying base scores (F088).
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
    return a.legal_name.localeCompare(b.legal_name);
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

/* ─── List sorting (F060 #62, F061 #63) ────────────────────────────────── */

/**
 * The fields the *list* can be sorted on. Deliberately not the same set as the
 * insight band's breakdown (`parseField` in client-insights.ts): that panel
 * groups and counts, this one orders rows. They read from different URL params
 * (`listSort`/`listDir` here, `sort`/`dir` there) so one can be changed without
 * disturbing the other — the two controls are visible on screen at once.
 */
export type ListSortField = "name" | "location" | "status";
/** Spelled out rather than asc/desc because the control is a sentence, and the
 * breakdown card next to it already uses these words (client-insights.ts). */
export type ListSortDirection = "ascending" | "descending";

export const LIST_SORT_FIELDS: { key: ListSortField; label: string }[] = [
  { key: "name", label: "name" },
  { key: "location", label: "location" },
  { key: "status", label: "outreach status" },
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
    } else {
      primary = byName(a, b);
    }
    if (primary !== 0) return primary * sign;
    return field === "name" ? 0 : byName(a, b);
  });
}
