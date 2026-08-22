/**
 * F051 — list-shaping logic behind the charity list view, kept out of the route
 * so it can be tested without a database (same split as @/lib/suppressions).
 */

import { formatLocation, formatOutreachStatus } from "../../lib/organisation-format.ts";

export { formatLocation, formatOutreachStatus };

export type ClientTagRow = { tag_id: string };

export type ClientListRow = {
  id: string;
  legal_name: string;
  organisation_type: string;
  city: string | null;
  country_code: string;
  geographic_reach?: string | null;
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
};

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
    }));
}

/**
 * F163 — owner filter (issue #163). `null`/`""` means no filter (everyone).
 * "unassigned" is a distinct value, not falsy, so it doesn't collapse into
 * the no-filter case and genuinely-unowned clients stay reachable rather
 * than only ever appearing when nothing is selected.
 */
export function filterByOwner(
  clients: VisibleClient[],
  ownerFilter: string | null | undefined,
): VisibleClient[] {
  if (!ownerFilter) return clients;
  if (ownerFilter === "unassigned") {
    return clients.filter((client) => client.owner_id === null);
  }
  return clients.filter((client) => client.owner_id === ownerFilter);
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
  search: string | null | undefined,
): VisibleClient[] {
  const term = search?.trim().toLowerCase();
  if (!term) return clients;
  return clients.filter((client) => client.legal_name.toLowerCase().includes(term));
}

export function filterByCity(
  clients: VisibleClient[],
  cityFilter: string | null | undefined,
): VisibleClient[] {
  if (!cityFilter) return clients;
  const term = cityFilter.toLowerCase();
  return clients.filter((client) => client.city?.toLowerCase() === term);
}

export function filterByStatus(
  clients: VisibleClient[],
  statusFilter: string | null | undefined,
): VisibleClient[] {
  if (!statusFilter) return clients;
  const term = statusFilter.toLowerCase();
  // We match against the formatted label (e.g. "Meeting set")
  return clients.filter((client) => client.outreachStatusLabel.toLowerCase() === term);
}

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

export type GeographicPreference = {
  preferred_geographic_reach?: string[] | null;
  preferred_cities?: string[] | null;
};

/**
 * The South Yorkshire city set and the expansions below — "regional" reach means
 * South Yorkshire, "local" reach means Sheffield, and both stack with exact city
 * matches (a Sheffield org under a Sheffield-preferring local CAM can reach +30
 * where an exact Leeds match gets +10) — are deliberate pilot scoping:
 * 180Connect currently serves the Sheffield branch only. When another branch
 * onboards this must become region-driven data, not more hardcoded cities.
 */
const SOUTH_YORKSHIRE_CITIES = new Set(["sheffield", "rotherham", "barnsley", "doncaster"]);

/**
 * F196 / F090 / F094 — Personalised CAM queue geographic weighting.
 *
 * Re-orders clients so that organisations matching the CAM's geographic reach
 * (local, regional, national, international) and/or preferred target cities
 * (e.g. Sheffield, South Yorkshire, Leeds, etc.) are prioritised higher in the
 * CAM's queue.
 *
 * If no geographic preference is active (or when cleared), returns the unmodified
 * list in its default unweighted order.
 */
export function prioritiseByGeography(
  clients: VisibleClient[],
  preferences?: GeographicPreference | null,
): VisibleClient[] {
  if (!preferences) return clients;

  const preferredReach = (preferences.preferred_geographic_reach ?? []).map((r) =>
    r.toLowerCase().trim(),
  );
  const preferredCities = (preferences.preferred_cities ?? []).map((c) =>
    c.toLowerCase().trim(),
  );

  if (preferredReach.length === 0 && preferredCities.length === 0) {
    return clients;
  }

  const wantsSouthYorkshire =
    preferredCities.some((c) => c === "south yorkshire" || c === "south yorks") ||
    preferredReach.includes("regional");
  const wantsLocalSheffield =
    preferredCities.some((c) => c === "sheffield") || preferredReach.includes("local");

  function getGeographicPriorityScore(client: VisibleClient): number {
    let score = 0;
    const clientCity = client.city?.toLowerCase().trim();

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

  return [...clients].sort((a, b) => {
    const scoreA = getGeographicPriorityScore(a);
    const scoreB = getGeographicPriorityScore(b);
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return a.legal_name.localeCompare(b.legal_name);
  });
}

