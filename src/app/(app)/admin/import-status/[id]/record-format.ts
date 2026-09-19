/**
 * Formatting and normalization logic for individual raw_source_records rows
 * on the Ingestion Run Detail page (/admin/import-status/[id]).
 *
 * Designed for non-technical admins and CAMs: business-first presentation
 * without developer jargon (no raw checksums, hashes, or technical traces in primary view).
 */

import {
  formatExactTime,
  formatRelativeTime,
  humaniseToken,
} from "../../../../../lib/display-format.ts";
import type { OrganisationPreview } from "../../../../../lib/recent-updates.ts";

export type ProcessingStatus = "pending" | "validated" | "matched" | "rejected" | "error";

export type RawSourceRecordRow = {
  id: string;
  ingestion_run_id: string;
  record_source: string;
  source_record_id: string;
  raw_payload: unknown;
  received_at: string;
  processing_status: ProcessingStatus;
  matched_organisation_id: string | null;
  checksum: string;
  ingestion_attempt: number;
  source_country: string | null;
  source_registry_name: string | null;
  excluded_fields: string[] | null;
  rule_version_applied: number | null;
};

export type StatusTone = "success" | "warning" | "info" | "danger" | "neutral";

export type StatusDetails = {
  label: string;
  tone: StatusTone;
  badgeClass: string;
  description: string;
  /**
   * Where the decision this record is waiting on is actually made, when it is
   * waiting on one. "Pending Review" used to be the label on records nobody
   * could review, on a page that named no queue — so a reader was told to do
   * something with no way to do it. A status that asks for a decision now
   * carries the link to the screen that takes it; a status that asks for
   * nothing says so instead of implying a chore.
   */
  reviewHref?: string;
  reviewLabel?: string;
};

const STATUS_MAP: Record<ProcessingStatus, StatusDetails> = {
  validated: {
    label: "Added",
    tone: "success",
    badgeClass: "bg-green-50 text-green-800 ring-green-600/20",
    description: "On the client list. Open the client to see it.",
  },
  matched: {
    label: "Possible duplicate",
    tone: "warning",
    badgeClass: "bg-amber-50 text-amber-800 ring-amber-600/20",
    description:
      "Held because it looks like a client already on the list. An admin decides whether it is the same one.",
    reviewHref: "/admin/duplicates",
    reviewLabel: "Decide it on Possible duplicates",
  },
  pending: {
    // Not a review, and never was: `pending` means staged from the register and
    // not yet promoted. Labelling it "Pending Review" sent admins looking for a
    // queue that does not exist for these records.
    label: "Waiting to be added",
    tone: "info",
    badgeClass: "bg-blue-50 text-blue-800 ring-blue-600/20",
    description:
      "Copied from the source and waiting its turn. The next import run adds it to the client list — nothing to decide.",
  },
  rejected: {
    label: "Did not meet the client criteria",
    tone: "neutral",
    badgeClass: "bg-black/[0.04] text-foreground/70 ring-black/[0.08]",
    description:
      "Outside the branch's client criteria — the wrong kind of organisation, or outside the region — so it was not added.",
  },
  error: {
    label: "Could not be saved",
    tone: "danger",
    badgeClass: "bg-red-50 text-red-800 ring-red-600/20",
    description:
      "The client list refused this record. The reason is at the top of this page, under the run's own heading.",
  },
};

/**
 * The other half of `rejected`: a record the criteria could not decide on its
 * own, which an admin answers on the review queue. Same stored status, two
 * different things to do about it, so the page has to tell them apart — the
 * caller says which by passing `heldForReview`.
 */
const HELD_FOR_REVIEW: StatusDetails = {
  label: "Held for review",
  tone: "warning",
  badgeClass: "bg-amber-50 text-amber-800 ring-amber-600/20",
  description:
    "The criteria could not decide this one, so it is waiting for an admin to say whether it belongs on the client list.",
  reviewHref: "/admin/review",
  reviewLabel: "Answer it on Review queue",
};

/**
 * The same five states, for a 360Giving run — and they mean something
 * different there, which is why this map exists at all.
 *
 * A grant import never creates a client. It reads grants that funders have
 * published and tries to attach each one to a client already on our list, by
 * charity or company number (`src/lib/standardize/three-sixty-giving.ts`). So
 * "matched" is the success here, not "added", and a grant whose recipient we
 * do not hold is simply not kept — nothing is waiting for anyone to decide.
 *
 * The old wording said "Pending Match — imported and queued for client
 * matching", which named a queue and a process rather than saying what has or
 * has not happened to the grant, and left a reader to guess whether it was
 * theirs to act on.
 *
 * `pending` and `rejected` are the pair worth keeping apart, because they look
 * alike and are not: `pending` has not been checked against the client list
 * yet, `rejected` was checked and the recipient is not a client. The checking
 * is `promotePendingThreeSixtyGivingRecords`, which the 360Giving backfill job
 * calls on every slice that finds grants (every 15 minutes — see
 * `docs/ingestion.md`), and which drains every pending row, not only the ones
 * belonging to the run being looked at.
 */
/**
 * A `matched` record nobody was asked about.
 *
 * The importer holds a record as `matched` whenever it recognises an existing
 * client, but only some of those go to the duplicates queue: a match on the
 * registration number that also agrees on name and postcode is treated as the
 * client we already hold and no candidate row is written for it
 * (`isCertainMatch`, write-organisations.ts). Those records are not possible
 * duplicates and there is nothing to decide about them, so they must not wear
 * the label — or the button — of the ones that are. The caller says which by
 * passing `duplicateQueued`.
 */
const ALREADY_HELD: StatusDetails = {
  label: "Already on the list",
  tone: "neutral",
  badgeClass: "bg-black/[0.04] text-foreground/70 ring-black/[0.08]",
  description:
    "The same registration number, name and postcode as a client already on the list, so this was treated as that client rather than added again. Nothing to decide.",
};

const GRANT_STATUS_MAP: Record<ProcessingStatus, StatusDetails> = {
  validated: {
    label: "Saved",
    tone: "success",
    badgeClass: "bg-green-50 text-green-800 ring-green-600/20",
    description: "Recorded against the client that received it.",
  },
  matched: {
    label: "Attached to a client",
    tone: "success",
    badgeClass: "bg-green-50 text-green-800 ring-green-600/20",
    description:
      "The charity or company number on this grant matched a client on the list, so the grant is now on that client's record.",
  },
  pending: {
    // Not the same as "the recipient is not a client", which is `rejected`
    // below. A grant that was checked and found no client is rejected; one
    // still sitting here has not been checked yet. The two used to read alike,
    // which made this one look like a dead end when nothing is wrong with it.
    label: "Waiting to be matched",
    tone: "info",
    badgeClass: "bg-blue-50 text-blue-800 ring-blue-600/20",
    description:
      "Read from 360Giving, and not yet checked against the client list — this does not mean the client is missing. The 360Giving job checks these automatically the next time it finds grants, and it runs every 15 minutes. Nothing to do.",
  },
  rejected: {
    label: "Recipient is not a client",
    tone: "neutral",
    badgeClass: "bg-black/[0.04] text-foreground/70 ring-black/[0.08]",
    description:
      "This one was checked: the charity or company that received the grant is not on the client list, and grant imports never add one. Add that organisation as a client and a later run will attach its grants.",
  },
  error: {
    label: "Could not be saved",
    tone: "danger",
    badgeClass: "bg-red-50 text-red-800 ring-red-600/20",
    description:
      "Something in this grant stopped it being saved — usually a missing amount, date or recipient. The reason is at the top of this page.",
  },
};

export function getStatusDetails(
  status: ProcessingStatus,
  source?: string | null,
  options?: { heldForReview?: boolean; duplicateQueued?: boolean },
): StatusDetails {
  const map = source === "360giving" ? GRANT_STATUS_MAP : STATUS_MAP;
  if (status === "rejected" && options?.heldForReview && source !== "360giving") {
    return HELD_FOR_REVIEW;
  }
  if (status === "matched" && options?.duplicateQueued === false && source !== "360giving") {
    return ALREADY_HELD;
  }
  return (
    map[status] ?? {
      label: humaniseToken(status),
      tone: "neutral",
      badgeClass: "bg-black/[0.04] text-foreground/70 ring-black/[0.08]",
      description: "Unknown status",
    }
  );
}

/**
 * The staged bulk-charity shape, for the extractors below.
 *
 * The register import stages each charity as `{ charity: {...}, annual_returns,
 * matched_classifications, matched_areas }` (see `toRawPayload`), while the
 * API path stages a flat record. Every extractor below was written against the
 * flat shape, so a pending bulk row — no organisation yet, nothing to rescue
 * it — fell through to the number fallback, no city, "Standard client" and no
 * address. One accessor for the nested object keeps that knowledge in one
 * place instead of spreading `p.charity?.x` across seven functions.
 */
function bulkCharity(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const top = payload as Record<string, unknown>;
  // `annual_returns` is the marker that this is the staged register shape:
  // toRawPayload always writes it (possibly empty), so a payload from any
  // other path that happens to carry a `charity` key is never misread here.
  if (!Array.isArray(top.annual_returns)) return null;
  const nested = top.charity;
  return typeof nested === "object" && nested !== null
    ? (nested as Record<string, unknown>)
    : null;
}

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function humaniseEntityType(type: unknown): string | null {  if (typeof type !== "string" || !type.trim()) return null;
  const t = type.toLowerCase().trim();
  if (t === "community-interest-company" || t === "cic") return "Community Interest Company (CIC)";
  if (t === "private-limited-guarant-nsc") return "Company Limited by Guarantee (Non-profit)";
  if (t === "ltd" || t === "private-limited-company") return "Private Limited Company (Ltd)";
  if (t === "charitable-incorporated-organisation" || t === "cio") return "Charitable Incorporated Organisation (CIO)";
  if (t === "registered-charity" || t === "charity") return "Registered Charity";
  if (t === "industrial-and-provident-society" || t === "bencom") return "Community Benefit Society";
  return humaniseToken(type);
}

export function extractRecordName(payload: unknown, fallbackId: string): string {
  if (typeof payload !== "object" || payload === null) return fallbackId;
  const p = payload as Record<string, unknown>;

  if (typeof p.legal_name === "string" && p.legal_name.trim()) return p.legal_name.trim();
  if (typeof p.company_name === "string" && p.company_name.trim()) return p.company_name.trim();
  if (typeof p.charity_name === "string" && p.charity_name.trim()) return p.charity_name.trim();
  if (typeof p.name === "string" && p.name.trim()) return p.name.trim();
  if (typeof p.title === "string" && p.title.trim()) return p.title.trim();

  // Bulk register extract: the name lives on the nested charity object.
  const nestedName = trimmedString(bulkCharity(payload)?.charity_name);
  if (nestedName) return nestedName;

  if (typeof p.recipient_organization_name === "string" && p.recipient_organization_name.trim()) {
    return p.recipient_organization_name.trim();
  }

  // 360Giving recipientOrganization array
  if (Array.isArray(p.recipientOrganization) && p.recipientOrganization.length > 0) {
    const first = p.recipientOrganization[0];
    if (typeof first === "object" && first !== null && "name" in first && typeof first.name === "string") {
      return first.name.trim();
    }
  }

  return fallbackId;
}

export function extractRecordCity(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  if (typeof p.city === "string" && p.city.trim()) return p.city.trim();

  // Companies House registered office address
  if (typeof p.registered_office_address === "object" && p.registered_office_address !== null) {
    const addr = p.registered_office_address as Record<string, unknown>;
    if (typeof addr.locality === "string" && addr.locality.trim()) return addr.locality.trim();
    if (typeof addr.postal_town === "string" && addr.postal_town.trim()) return addr.postal_town.trim();
  }

  // Charity Commission address
  if (typeof p.contact === "object" && p.contact !== null) {
    const contact = p.contact as Record<string, unknown>;
    if (typeof contact.address === "object" && contact.address !== null) {
      const addr = contact.address as Record<string, unknown>;
      if (typeof addr.city === "string" && addr.city.trim()) return addr.city.trim();
    }
  }

  return null;
}

/**
 * Postcode when there is no city to show. The bulk register extract carries no
 * town — only `charity_contact_postcode` — so pending bulk rows would otherwise
 * show no location at all. Rendered with the same pin, in the city's place.
 */
export function extractRecordPostcode(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  const flat =
    trimmedString(p.postcode) ?? trimmedString(p.postal_code) ?? trimmedString(p.postalCode);
  if (flat) return flat;

  return trimmedString(bulkCharity(payload)?.charity_contact_postcode);
}

export function formatFullAddress(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  // Bulk register extract: five address lines plus a postcode, all nested.
  const bulk = bulkCharity(payload);
  if (bulk && !p.registered_office_address && !p.contact && !p.address) {
    const parts: string[] = [];
    for (const key of [
      "charity_contact_address1",
      "charity_contact_address2",
      "charity_contact_address3",
      "charity_contact_address4",
      "charity_contact_address5",
      "charity_contact_postcode",
    ]) {
      const line = trimmedString(bulk[key]);
      if (line) parts.push(line);
    }
    return parts.length > 0 ? parts.join(", ") : null;
  }

  let addrObj: Record<string, unknown> | null = null;
  if (typeof p.registered_office_address === "object" && p.registered_office_address !== null) {
    addrObj = p.registered_office_address as Record<string, unknown>;
  } else if (typeof p.contact === "object" && p.contact !== null) {
    const c = p.contact as Record<string, unknown>;
    if (typeof c.address === "object" && c.address !== null) {
      addrObj = c.address as Record<string, unknown>;
    }
  } else if (typeof p.address === "object" && p.address !== null) {
    addrObj = p.address as Record<string, unknown>;
  }

  if (!addrObj) return null;

  const parts: string[] = [];
  const line1 = addrObj.address_line_1 || addrObj.street_address || addrObj.addressLine1 || addrObj.line1;
  const line2 = addrObj.address_line_2 || addrObj.addressLine2 || addrObj.line2;
  const locality = addrObj.locality || addrObj.city || addrObj.postal_town || addrObj.town;
  const region = addrObj.region || addrObj.county;
  const postcode = addrObj.postal_code || addrObj.postcode || addrObj.postalCode;
  const country = addrObj.country;

  for (const part of [line1, line2, locality, region, postcode, country]) {
    if (typeof part === "string" && part.trim()) {
      parts.push(part.trim());
    }
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

export function extractMissionOrActivities(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  if (typeof p.activities === "string" && p.activities.trim()) return p.activities.trim();
  if (typeof p.mission_statement === "string" && p.mission_statement.trim()) return p.mission_statement.trim();
  const nestedActivities = trimmedString(bulkCharity(payload)?.charity_activities);
  if (nestedActivities) return nestedActivities;  if (typeof p.objects === "string" && p.objects.trim()) return p.objects.trim();
  if (typeof p.description === "string" && p.description.trim()) return p.description.trim();

  if (Array.isArray(p.sic_codes) && p.sic_codes.length > 0) {
    return `Nature of business (SIC codes): ${p.sic_codes.join(", ")}`;
  }

  return null;
}

export function extractWebsiteUrl(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  if (typeof p.website === "string" && p.website.trim()) return p.website.trim();
  if (typeof p.website_url === "string" && p.website_url.trim()) return p.website_url.trim();
  const nestedWebsite = trimmedString(bulkCharity(payload)?.charity_contact_web);
  if (nestedWebsite) return nestedWebsite;

  if (typeof p.contact === "object" && p.contact !== null) {
    const c = p.contact as Record<string, unknown>;
    if (typeof c.website_url === "string" && c.website_url.trim()) return c.website_url.trim();
    if (typeof c.website === "string" && c.website.trim()) return c.website.trim();
  }

  return null;
}

export function extractRegistryStatus(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  if (typeof p.company_status === "string" && p.company_status.trim()) {
    return humaniseToken(p.company_status.trim());
  }
  if (typeof p.charity_status === "string" && p.charity_status.trim()) {
    return humaniseToken(p.charity_status.trim());
  }
  if (typeof p.status === "string" && p.status.trim()) {
    return humaniseToken(p.status.trim());
  }

  // Bulk register extract: the register's own reporting status, nested.
  const bulk = bulkCharity(payload);
  const nestedStatus =
    trimmedString(bulk?.charity_reporting_status) ?? trimmedString(bulk?.charity_registration_status);
  if (nestedStatus) return humaniseToken(nestedStatus);

  return null;
}

export function extractFilingType(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  if (typeof p.type === "string" && p.type.trim()) {
    return humaniseEntityType(p.type.trim());
  }
  if (typeof p.organisation_type === "string" && p.organisation_type.trim()) {
    return humaniseEntityType(p.organisation_type.trim());
  }
  if (typeof p.charity_type === "string" && p.charity_type.trim()) {
    return humaniseEntityType(p.charity_type.trim());
  }

  // Bulk register extract: the only type signal staged is the CIO flag, and a
  // bulk row is a registered charity by construction (the file holds nothing
  // else), so "Standard client" never fits one.
  const bulk = bulkCharity(payload);
  if (bulk) {
    if (bulk.charity_is_cio === 1 || bulk.charity_is_cio === true) {
      return humaniseEntityType("cio");
    }
    return "Registered Charity";
  }

  return null;
}

export type GrantDetails = {
  funderName: string | null;
  amountFormatted: string | null;
  awardDate: string | null;
  grantProgramme: string | null;
  description: string | null;
};

export function extractGrantDetails(payload: unknown): GrantDetails | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  const fundingOrg = Array.isArray(p.fundingOrganization) ? p.fundingOrganization[0] : null;
  const funderName =
    typeof fundingOrg === "object" && fundingOrg !== null && typeof fundingOrg.name === "string"
      ? fundingOrg.name.trim()
      : typeof p.funder_name === "string"
        ? p.funder_name.trim()
        : null;

  const amount =
    typeof p.amountAwarded === "number"
      ? p.amountAwarded
      : typeof p.amount_awarded === "number"
        ? p.amount_awarded
        : null;
  const currency = typeof p.currency === "string" ? p.currency : "GBP";
  const amountFormatted =
    amount !== null
      ? new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount)
      : null;

  const rawDate = typeof p.awardDate === "string" ? p.awardDate : typeof p.award_date === "string" ? p.award_date : null;
  const awardDate = rawDate ? rawDate.slice(0, 10) : null;

  const programmeArr = Array.isArray(p.grantProgramme) ? p.grantProgramme[0] : null;
  const grantProgramme =
    typeof programmeArr === "object" && programmeArr !== null && typeof programmeArr.title === "string"
      ? programmeArr.title.trim()
      : typeof p.grant_programme === "string"
        ? p.grant_programme.trim()
        : null;

  const description = typeof p.description === "string" ? p.description.trim() : null;

  if (!funderName && !amountFormatted && !awardDate && !description && !grantProgramme) return null;

  return { funderName, amountFormatted, awardDate, grantProgramme, description };
}

export type RawRecordView = {
  id: string;
  sourceRecordId: string;
  recordSource: string;
  name: string;
  city: string | null;
  /** Postcode, shown with the pin when there is no city (bulk rows carry no town). */
  postcode: string | null;
  fullAddress: string | null;
  missionOrActivities: string | null;
  website: string | null;
  filingType: string | null;
  registryStatus: string | null;
  processingStatus: ProcessingStatus;
  /**
   * What the row is filtered by, as one value. `processing_status` alone cannot
   * say it: a record held for an admin's decision and one the criteria settled
   * are both stored `rejected`, and the filter has to offer them separately
   * because they are different jobs — see `HELD_FOR_REVIEW`.
   */
  statusKey: string;
  /** True when this record is waiting on the review queue. */
  heldForReview: boolean;
  /**
   * For a `matched` record: whether it is actually on the duplicates queue.
   * False means the importer was certain and asked nobody — see `ALREADY_HELD`.
   */
  duplicateQueued: boolean;
  status: StatusDetails;
  matchedOrgId: string | null;
  matchedOrg: OrganisationPreview | null;
  grantDetails: GrantDetails | null;
  redactedFieldCount: number;
  excludedFields: string[];
  /** When the record was read, as a sortable number. The two strings below
   *  are for reading; this is for ordering. */
  receivedAt: number;
  receivedExact: string;
  receivedRelative: string;
  rawPayloadJson: string;
};

export function describeRawRecord(
  row: RawSourceRecordRow,
  orgPreview: OrganisationPreview | null,
  now: Date,
  /** True when this record is sitting on the review queue — see `getStatusDetails`. */
  options?: { heldForReview?: boolean; duplicateQueued?: boolean },
): RawRecordView {
  const heldForReview = Boolean(options?.heldForReview) && row.processing_status === "rejected";
  // Defaults to queued: a run read before this distinction existed has a
  // candidate row for every match, and calling one of those "already on the
  // list" would hide a decision somebody still owes.
  const duplicateQueued = options?.duplicateQueued ?? true;
  const received = new Date(row.received_at);
  const name = orgPreview?.legalName || extractRecordName(row.raw_payload, row.source_record_id);
  const city = orgPreview?.city || extractRecordCity(row.raw_payload);
  const postcode = extractRecordPostcode(row.raw_payload);
  const excluded = Array.isArray(row.excluded_fields) ? row.excluded_fields : [];
  const fullAddress = formatFullAddress(row.raw_payload);
  const missionOrActivities = extractMissionOrActivities(row.raw_payload);
  const website = orgPreview?.website || extractWebsiteUrl(row.raw_payload);
  const filingType = orgPreview?.organisationType ? humaniseEntityType(orgPreview.organisationType) : extractFilingType(row.raw_payload);
  const registryStatus = extractRegistryStatus(row.raw_payload);
  const grantDetails = row.record_source === "360giving" ? extractGrantDetails(row.raw_payload) : null;

  let jsonStr = "{}";
  try {
    jsonStr = JSON.stringify(row.raw_payload, null, 2);
  } catch {
    jsonStr = String(row.raw_payload);
  }

  return {
    id: row.id,
    sourceRecordId: row.source_record_id,
    recordSource: row.record_source,
    name,
    city,
    postcode,
    fullAddress,
    missionOrActivities,
    website,
    filingType,
    registryStatus,
    processingStatus: row.processing_status,
    statusKey: recordStatusKey(row.processing_status, heldForReview, duplicateQueued),
    heldForReview,
    duplicateQueued,
    status: getStatusDetails(row.processing_status, row.record_source, {
      ...options,
      duplicateQueued,
    }),
    matchedOrgId: row.matched_organisation_id,
    matchedOrg: orgPreview,
    grantDetails,
    redactedFieldCount: excluded.length,
    excludedFields: excluded,
    receivedAt: received.getTime(),
    receivedExact: formatExactTime(received),
    receivedRelative: formatRelativeTime(received, now),
    rawPayloadJson: jsonStr,
  };
}

/**
 * The value a record is filtered on. Held-for-review splits off `rejected`
 * rather than sharing it, so choosing "did not meet the criteria" never hands
 * back records that are actually waiting for someone.
 */
export function recordStatusKey(
  status: ProcessingStatus,
  heldForReview: boolean,
  duplicateQueued: boolean = true,
): string {
  if (heldForReview && status === "rejected") return "rejected_review";
  // A certain match and a possible duplicate are both stored `matched` and are
  // different answers to "is anything waiting on me", so the filter has to be
  // able to ask for one without the other.
  if (status === "matched" && !duplicateQueued) return "matched_held";
  return status;
}

/** Whether a record is on the client list — the thing "Added" ultimately means. */
export function isLinkedToClient(view: RawRecordView): boolean {
  return Boolean(view.matchedOrgId);
}

/**
 * The filters the page offers, each as the list of chosen values. Empty (or
 * absent) means the filter is not applied — never "match nothing", so a link
 * carrying an unknown value still shows the run rather than an empty page.
 */
export type RecordFilters = {
  /** `statusKey` values — what happened to the record. */
  status?: string[];
  /** Town or postcode, exactly as the row shows it. */
  place?: string[];
  /** `filingType` values — the kind of organisation. */
  kind?: string[];
  /** "linked" (on the client list) or "unlinked". */
  link?: string[];
  /** "removed" (personal details were stripped) or "kept". */
  details?: string[];
};

function chosen(values: string[] | undefined): Set<string> | null {
  if (!values || values.length === 0) return null;
  return new Set(values);
}

/**
 * Every chosen filter must hold, and within one filter any chosen value will
 * do — three towns means three towns, not none.
 */
export function matchesRecordFilters(
  view: RawRecordView,
  filters: RecordFilters,
): boolean {
  const status = chosen(filters.status);
  if (status && !status.has(view.statusKey)) return false;

  const place = chosen(filters.place);
  if (place) {
    const own = view.city ?? view.postcode;
    if (!own || !place.has(own)) return false;
  }

  const kind = chosen(filters.kind);
  if (kind && (!view.filingType || !kind.has(view.filingType))) return false;

  const link = chosen(filters.link);
  if (link) {
    const own = isLinkedToClient(view) ? "linked" : "unlinked";
    if (!link.has(own)) return false;
  }

  const details = chosen(filters.details);
  if (details) {
    const own = view.redactedFieldCount > 0 ? "removed" : "kept";
    if (!details.has(own)) return false;
  }

  return true;
}

/**
 * The choices a filter can offer, built from the records actually in the run.
 *
 * Offering a value nothing has is offering an empty page, and the labels differ
 * by source (a 360Giving run says "Matched to Client" where a register run says
 * "Added"), so the options are read off the records rather than listed here.
 * Sorted by how common they are, then alphabetically, so the usual answer is
 * first without the order jumping about between runs that tie.
 */
export function recordFilterOptions(
  views: RawRecordView[],
  pick: (view: RawRecordView) => { label: string; value: string } | null,
): { label: string; value: string }[] {
  const counts = new Map<string, { label: string; value: string; count: number }>();
  for (const view of views) {
    const option = pick(view);
    if (!option) continue;
    const existing = counts.get(option.value);
    if (existing) existing.count += 1;
    else counts.set(option.value, { ...option, count: 1 });
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map(({ label, value }) => ({ label, value }));
}

/**
 * What the records can be put in order by, and which way round.
 *
 * Four orders, because four are the questions people actually arrive with:
 * when it came in (the run's own order), who it is, what happened to it, and
 * where it is. Anything else is reachable by searching for it.
 */
export type RecordSortField = "read" | "name" | "outcome" | "place";
export type SortDirection = "asc" | "desc";

export const RECORD_SORT_FIELDS: RecordSortField[] = ["read", "name", "outcome", "place"];

export function isRecordSortField(value: string): value is RecordSortField {
  return (RECORD_SORT_FIELDS as string[]).includes(value);
}

/**
 * How far through the run a record got, as a number to sort on.
 *
 * Read off the status's tone rather than its stored value: the tones already
 * rank the same way a reader does — on the list, waiting, held, set aside,
 * broken — and reading them here means a source with its own words for those
 * states (360Giving) sorts correctly without a second table of its own.
 */
const OUTCOME_RANK: Record<StatusTone, number> = {
  success: 0,
  info: 1,
  warning: 2,
  neutral: 3,
  danger: 4,
};

function comparable(view: RawRecordView, field: RecordSortField): string | number {
  switch (field) {
    case "name":
      return view.name.toLowerCase();
    case "outcome":
      return OUTCOME_RANK[view.status.tone];
    case "place":
      return (view.city ?? view.postcode ?? "").toLowerCase();
    case "read":
      return view.receivedAt;
  }
}

/**
 * The records in the chosen order, as a new array — the caller's list is left
 * alone.
 *
 * Two things every order does. A record with no town sorts to the end whichever
 * way the list runs, because "nothing" is not a place between A and Z and a
 * column of blanks at the top of an A-to-Z is not what anyone asked for. And
 * every order falls back to the name, so two records that tie do not swap
 * places between one render and the next.
 */
export function sortRecords(
  views: RawRecordView[],
  field: RecordSortField,
  direction: SortDirection,
): RawRecordView[] {
  const sign = direction === "desc" ? -1 : 1;

  return [...views].sort((a, b) => {
    const left = comparable(a, field);
    const right = comparable(b, field);

    if (field === "place") {
      // Empty sorts last in both directions, so the sign is applied to the
      // comparison but never to the absence.
      if (left === "" && right !== "") return 1;
      if (right === "" && left !== "") return -1;
    }

    if (left < right) return -1 * sign;
    if (left > right) return 1 * sign;

    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

export function matchesRecordQuery(view: RawRecordView, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;

  const haystack = [
    view.name,
    view.sourceRecordId,
    view.city ?? "",
    view.postcode ?? "",
    view.fullAddress ?? "",
    view.recordSource,
    view.status.label,
    view.filingType ?? "",
    view.missionOrActivities ?? "",
    view.matchedOrg?.sector ?? "",
    view.grantDetails?.funderName ?? "",
    view.grantDetails?.grantProgramme ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return term.split(/\s+/).every((word) => haystack.includes(word));
}
