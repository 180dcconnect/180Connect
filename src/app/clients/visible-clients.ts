/**
 * F051 — list-shaping logic behind the charity list view, kept out of the route
 * so it can be tested without a database (same split as @/lib/suppressions).
 */

import { formatLocation, formatOutreachStatus } from "../../lib/organisation-format.ts";
import { deriveIncomeBand } from "../settings/outreach-preferences/constants.ts";

export { formatLocation, formatOutreachStatus };

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
    .filter((org) => statusByOrg.get(org.id) !== "active")
    .map((org) => ({
      ...org,
      location: formatLocation(org),
      outreachStatusLabel: formatOutreachStatus(org.outreach_status),
      suppressionPending: statusByOrg.get(org.id) === "pending",
      ownerName: org.owner_id ? (org.owner?.full_name ?? "A former team member") : null,
      income_band: resolveClientIncomeBand(org),
      has_grants: Boolean(org.has_grants || (org.grants && org.grants.length > 0)),
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

/** F053: search by client legal name (case-insensitive substring match). */
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
    return clients.filter(
      (c) => c.organisation_type === "company" || c.organisation_type === "both",
    );
  }
  if (term === "charity commission") {
    return clients.filter(
      (c) => c.organisation_type === "charity" || c.organisation_type === "both",
    );
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

export type GeographicPreference = OutreachQueuePreferences;

const SOUTH_YORKSHIRE_CITIES = new Set(["sheffield", "rotherham", "barnsley", "doncaster"]);

const CANONICAL_SECTOR_GROUPS: Record<string, string[]> = {
  health: ["health", "healthcare", "medical", "hospital", "mental health", "disability support", "clinical"],
  education: ["education", "training", "school", "college", "university", "literacy", "teaching", "skills"],
  environment: ["environment", "conservation", "climate", "sustainability", "wildlife", "animal welfare", "renewable energy"],
  poverty: ["poverty", "food bank", "homeless", "housing & homelessness", "hardship", "deprivation", "poverty relief"],
  community: ["community development", "youth & children", "family support", "social inclusion", "youth services"],
  arts: ["arts & culture", "heritage & museums", "theatre", "sports & recreation", "museum"],
  justice: ["international aid", "human rights", "justice", "social enterprise"],
};

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

    // Direct exact or substring match
    if (clientSector === p || (clientSector && p.includes(clientSector)) || (clientSector && clientSector.includes(p))) {
      score = Math.max(score, 10);
      continue;
    }

    if (clientSubSector === p || (clientSubSector && clientSubSector.includes(p))) {
      score = Math.max(score, 8);
      continue;
    }

    // Canonical category match (e.g. "Health & Social Care" matches "Healthcare")
    for (const [groupKey, groupAliases] of Object.entries(CANONICAL_SECTOR_GROUPS)) {
      const prefMatchesGroup = groupAliases.some((alias) => p.includes(alias)) || p.includes(groupKey);
      const clientMatchesGroup = groupAliases.some((alias) => clientText.includes(alias)) || clientText.includes(groupKey);

      if (prefMatchesGroup && clientMatchesGroup) {
        score = Math.max(score, 8);
      }
    }
  }

  return score;
}

/** Computes geographic weighting score for a client given CAM geographic preferences (F196 / F090). */
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
 * F196 / F090 / F094 — Backward compatible alias for geographic prioritisation.
 */
export function prioritiseByGeography(
  clients: VisibleClient[],
  preferences?: GeographicPreference | null,
): VisibleClient[] {
  return prioritiseQueue(clients, preferences);
}
