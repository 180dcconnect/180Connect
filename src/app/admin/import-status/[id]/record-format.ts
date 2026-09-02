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
} from "../../../../lib/display-format.ts";
import type { OrganisationPreview } from "../../../../lib/recent-updates.ts";

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
};

const STATUS_MAP: Record<ProcessingStatus, StatusDetails> = {
  validated: {
    label: "Added to CRM",
    tone: "success",
    badgeClass: "bg-green-50 text-green-800 ring-green-600/20",
    description: "Successfully added to your active clients in 180Connect",
  },
  matched: {
    label: "Duplicate Candidate",
    tone: "warning",
    badgeClass: "bg-amber-50 text-amber-800 ring-amber-600/20",
    description: "Flagged for admin review as a potential duplicate of an existing client",
  },
  pending: {
    label: "Pending Review",
    tone: "info",
    badgeClass: "bg-blue-50 text-blue-800 ring-blue-600/20",
    description: "Imported and queued for automatic profile completion",
  },
  rejected: {
    label: "Excluded by Criteria",
    tone: "neutral",
    badgeClass: "bg-black/[0.04] text-foreground/70 ring-black/[0.08]",
    description: "Filtered out (e.g. non-qualifying organisation type or outside region)",
  },
  error: {
    label: "Import Issue",
    tone: "danger",
    badgeClass: "bg-red-50 text-red-800 ring-red-600/20",
    description: "Could not be processed due to missing required registry details",
  },
};

export function getStatusDetails(status: ProcessingStatus): StatusDetails {
  return (
    STATUS_MAP[status] ?? {
      label: humaniseToken(status),
      tone: "neutral",
      badgeClass: "bg-black/[0.04] text-foreground/70 ring-black/[0.08]",
      description: "Unknown status",
    }
  );
}

export function humaniseEntityType(type: unknown): string | null {
  if (typeof type !== "string" || !type.trim()) return null;
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

export function formatFullAddress(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

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
  if (typeof p.objects === "string" && p.objects.trim()) return p.objects.trim();
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

  return null;
}

export type RawRecordView = {
  id: string;
  sourceRecordId: string;
  recordSource: string;
  name: string;
  city: string | null;
  fullAddress: string | null;
  missionOrActivities: string | null;
  website: string | null;
  filingType: string | null;
  registryStatus: string | null;
  processingStatus: ProcessingStatus;
  status: StatusDetails;
  matchedOrgId: string | null;
  matchedOrg: OrganisationPreview | null;
  redactedFieldCount: number;
  excludedFields: string[];
  receivedExact: string;
  receivedRelative: string;
  rawPayloadJson: string;
};

export function describeRawRecord(
  row: RawSourceRecordRow,
  orgPreview: OrganisationPreview | null,
  now: Date,
): RawRecordView {
  const received = new Date(row.received_at);
  const name = orgPreview?.legalName || extractRecordName(row.raw_payload, row.source_record_id);
  const city = orgPreview?.city || extractRecordCity(row.raw_payload);
  const excluded = Array.isArray(row.excluded_fields) ? row.excluded_fields : [];
  const fullAddress = formatFullAddress(row.raw_payload);
  const missionOrActivities = extractMissionOrActivities(row.raw_payload);
  const website = orgPreview?.website || extractWebsiteUrl(row.raw_payload);
  const filingType = orgPreview?.organisationType ? humaniseEntityType(orgPreview.organisationType) : extractFilingType(row.raw_payload);
  const registryStatus = extractRegistryStatus(row.raw_payload);

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
    fullAddress,
    missionOrActivities,
    website,
    filingType,
    registryStatus,
    processingStatus: row.processing_status,
    status: getStatusDetails(row.processing_status),
    matchedOrgId: row.matched_organisation_id,
    matchedOrg: orgPreview,
    redactedFieldCount: excluded.length,
    excludedFields: excluded,
    receivedExact: formatExactTime(received),
    receivedRelative: formatRelativeTime(received, now),
    rawPayloadJson: jsonStr,
  };
}

export function matchesRecordQuery(view: RawRecordView, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;

  const haystack = [
    view.name,
    view.sourceRecordId,
    view.city ?? "",
    view.fullAddress ?? "",
    view.recordSource,
    view.status.label,
    view.filingType ?? "",
    view.missionOrActivities ?? "",
    view.matchedOrg?.sector ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return term.split(/\s+/).every((word) => haystack.includes(word));
}
