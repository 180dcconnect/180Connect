/**
 * F051 — list-shaping logic behind the charity list view, kept out of the route
 * so it can be tested without a database (same split as @/lib/suppressions).
 */

import { formatLocation, formatOutreachStatus } from "../../lib/organisation-format.ts";

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
