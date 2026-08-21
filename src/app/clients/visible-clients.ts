/**
 * F051 — list-shaping logic behind the charity list view, kept out of the route
 * so it can be tested without a database (same split as @/lib/suppressions).
 */

import {
  PIPELINE_STATUSES,
  formatLocation,
  formatOutreachStatus,
  type PipelineStatus,
} from "../../lib/organisation-format.ts";

export { formatLocation, formatOutreachStatus };

export type ClientListRow = {
  id: string;
  legal_name: string;
  organisation_type: string;
  city: string | null;
  country_code: string;
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
 * default the list has always used — alphabetical by name, ascending. */
export function parseListSort(value: string | null | undefined): ListSortField {
  return LIST_SORT_FIELDS.some((field) => field.key === value)
    ? (value as ListSortField)
    : "name";
}

export function parseListDirection(value: string | null | undefined): ListSortDirection {
  return value === "descending" ? "descending" : "ascending";
}

/**
 * Rank of a status in the pipeline (F061 AC1): its index in PIPELINE_STATUSES,
 * which is the order F145/F146-F155 define, *not* alphabetical order of the
 * label — "Converted" would otherwise sort before "Initial outreach sent".
 * A status not in that list sorts to the end rather than to the front, so a
 * value added to the database before it is added here is visibly last instead
 * of silently leading the list.
 *
 * The order itself, and the reasoning for it, is written down in
 * docs/client-list-sorting.md — F061 AC3 asks for exactly that.
 */
function pipelineRank(status: string): number {
  const index = PIPELINE_STATUSES.indexOf(status as PipelineStatus);
  return index === -1 ? PIPELINE_STATUSES.length : index;
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
      primary = pipelineRank(a.outreach_status) - pipelineRank(b.outreach_status);
    } else {
      primary = byName(a, b);
    }
    if (primary !== 0) return primary * sign;
    return field === "name" ? 0 : byName(a, b);
  });
}
