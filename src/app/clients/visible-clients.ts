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
