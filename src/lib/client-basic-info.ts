/**
 * F068 — basic-info section logic behind the client detail page, kept out of the
 * route so it can be tested without a database (same split as @/lib/suppressions).
 * Covers both display formatting (AC1/AC2) and folding a Realtime `postgres_changes`
 * payload into that display state (AC3), the same split team-realtime.ts uses for
 * the admin team list.
 */

import { formatLocation, formatOutreachStatus } from "./organisation-format.ts";

const NOT_PROVIDED = "Not provided";

export type OrganisationDetailRow = {
  id: string;
  legal_name: string;
  organisation_type: string;
  website: string | null;
  contact_email: string | null;
  address_line_1: string | null;
  city: string | null;
  postcode: string | null;
  country_code: string;
  outreach_status: string;
};

/** Basic-info state as held by the client component: the org row plus the
 * latest enrichment mission, tracked separately since it comes from a
 * different table (ENRICHMENT_RESULTS) and arrives on its own Realtime feed. */
export type BasicInfoState = {
  organisation: OrganisationDetailRow;
  missionStatement: string | null;
  /** enriched_at of the row missionStatement came from — lets a late/out-of-order
   * Realtime event be dropped instead of stomping newer data with older. Null
   * when there is no enrichment row yet. */
  missionEnrichedAt: string | null;
};

export type BasicInfo = {
  name: string;
  type: string;
  mission: string;
  email: string;
  address: string;
  location: string;
  website: string;
  status: string;
};

/** AC2: a field with no value is shown as explicitly blank/unknown, never omitted. */
function displayValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : NOT_PROVIDED;
}

function formatAddress(
  organisation: Pick<OrganisationDetailRow, "address_line_1" | "postcode">,
): string {
  const parts = [organisation.address_line_1, organisation.postcode]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : NOT_PROVIDED;
}

/** Builds the single visible basic-info section (F068 AC1) from live state. */
export function buildBasicInfo(state: BasicInfoState): BasicInfo {
  const { organisation, missionStatement } = state;
  return {
    name: organisation.legal_name,
    type: organisation.organisation_type,
    mission: displayValue(missionStatement),
    email: displayValue(organisation.contact_email),
    address: formatAddress(organisation),
    location: formatLocation(organisation),
    website: displayValue(organisation.website),
    status: formatOutreachStatus(organisation.outreach_status),
  };
}

type RealtimeOrganisationRow = Partial<OrganisationDetailRow> & { id?: string };
type RealtimeOrganisationPayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: RealtimeOrganisationRow;
};

/**
 * Folds an `organisations` row change into basic-info state (F068 AC3). A DELETE
 * is left alone here — the row this page is looking at having been deleted is
 * F067 AC3's "no longer exists" case, which the page handles by re-navigating,
 * not by this panel silently blanking itself out mid-view.
 */
export function applyOrganisationChange(
  state: BasicInfoState,
  payload: RealtimeOrganisationPayload,
): BasicInfoState {
  if (payload.eventType === "DELETE") return state;
  const row = payload.new;
  // A redacted or otherwise incomplete payload, or a broadcast for a different
  // organisation than this page is showing, is never actionable.
  if (!row.id || row.id !== state.organisation.id) return state;
  return { ...state, organisation: { ...state.organisation, ...row } };
}

type RealtimeEnrichmentRow = {
  organisation_id?: string;
  mission_statement?: string | null;
  enriched_at?: string;
};
type RealtimeEnrichmentPayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: RealtimeEnrichmentRow;
};

/**
 * Folds an `enrichment_results` row change into basic-info state. ENRICHMENT_RESULTS
 * is append-only (20260804180000_create_org_children.sql) — a new row is a newer
 * enrichment run, not an edit of the old one — so this keeps whichever row has the
 * latest enriched_at rather than just the latest event.
 */
export function applyEnrichmentChange(
  state: BasicInfoState,
  payload: RealtimeEnrichmentPayload,
): BasicInfoState {
  if (payload.eventType === "DELETE") return state;
  const row = payload.new;
  if (!row.organisation_id || row.organisation_id !== state.organisation.id) return state;
  if (!row.enriched_at) return state;
  if (state.missionEnrichedAt && row.enriched_at <= state.missionEnrichedAt) return state;
  return {
    ...state,
    missionStatement: row.mission_statement ?? null,
    missionEnrichedAt: row.enriched_at,
  };
}
