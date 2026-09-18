import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission, isViewOnly } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchPaged } from "@/lib/supabase/fetch-paged";
import { reportError } from "@/lib/error-logging";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { containsRedactionPlaceholder } from "@/lib/ingestion/personal-data";
import { IncompleteRecordsPanel } from "./incomplete-records-panel";
import type { IncompleteClientRecord } from "./types";
import {
  describeAuditEvent,
  groupByDay,
  type AuditRow,
} from "@/lib/audit-log-format";

type RawOrgRow = {
  id: string;
  legal_name: string;
  trading_name: string | null;
  organisation_type: string;
  city: string | null;
  address_line_1: string | null;
  postcode: string | null;
  country_code: string;
  sector: string | null;
  sub_sector: string | null;
  website: string | null;
  website_absent_at: string | null;
  contact_email: string | null;
  charity_activities: string | null;
  cic_community_statement: string | null;
  outreach_status: string;
};

type OpenSuppression = {
  organisation_id: string;
  status: "pending" | "active";
};

type EnrichmentRow = {
  organisation_id: string;
  mission_statement: string | null;
  sector: string | null;
  sub_sector: string | null;
  enriched_at: string;
};

type IdentifierRow = {
  organisation_id: string;
  identifier_type: string;
  identifier_value: string;
};

export default async function IncompleteRecordsPage() {
  const authorization = await getViewingActor("approval:manage", {
    route: "/admin/incomplete-records",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const canEdit =
    hasPermission(authorization.actor.role, "approval:manage") &&
    !isViewOnly(authorization.actor.role);

  const supabase = await createClient();

  const [organisationsRes, suppressionsRes, enrichmentRes] = await Promise.all([
    fetchPaged<RawOrgRow>(
      (from, to) =>
        supabase
          .from("organisations")
          .select(
            "id, legal_name, trading_name, organisation_type, city, address_line_1, postcode, country_code, sector, sub_sector, website, website_absent_at, contact_email, charity_activities, cic_community_statement, outreach_status",
          )
          .order("legal_name", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
          .overrideTypes<RawOrgRow[], { merge: false }>(),
      { pagesPerRound: 3 },
    ),
    fetchPaged<OpenSuppression>((from, to) =>
      supabase
        .from("suppressions")
        .select("organisation_id, status")
        .in("status", ["pending", "active"])
        .order("organisation_id", { ascending: true })
        .range(from, to)
        .overrideTypes<OpenSuppression[], { merge: false }>(),
    ),
    // Enrichment carries both fallback missions and the pipeline's own sector
    // classifications. Unfiltered and paged like the organisations read: a
    // sector suggestion can sit on a row with no mission, so filtering to
    // mission rows would hide it — and an unpaged select would silently stop
    // at PostgREST's row window.
    fetchPaged<EnrichmentRow>(
      (from, to) =>
        supabase
          .from("enrichment_results")
          .select("organisation_id, mission_statement, sector, sub_sector, enriched_at")
          .order("enriched_at", { ascending: false })
          .order("organisation_id", { ascending: true })
          .range(from, to)
          .overrideTypes<EnrichmentRow[], { merge: false }>(),
      { pagesPerRound: 3 },
    ),
  ]);

  if (organisationsRes.error) {
    await reportError(organisationsRes.error, {
      operation: "admin.incomplete_records.organisations",
    });
  }
  if (suppressionsRes.error) {
    await reportError(suppressionsRes.error, {
      operation: "admin.incomplete_records.suppressions",
    });
  }
  if (enrichmentRes.error) {
    await reportError(enrichmentRes.error, {
      operation: "admin.incomplete_records.enrichment",
    });
  }

  const suppressedIds = new Set(
    (suppressionsRes.data ?? [])
      .filter((s) => s.status === "active")
      .map((s) => s.organisation_id),
  );

  const enrichmentMissionByOrg = new Map<string, string>();
  // The pipeline's own sector classification per org, newest row first: the
  // first non-blank sector wins, keeping its row's sub-sector so the pair
  // stays consistent. Read for suggestion only — never written back here.
  const enrichmentSectorByOrg = new Map<string, { sector: string; sub_sector: string | null }>();
  for (const row of enrichmentRes.data ?? []) {
    if (row.mission_statement?.trim() && !enrichmentMissionByOrg.has(row.organisation_id)) {
      enrichmentMissionByOrg.set(row.organisation_id, row.mission_statement.trim());
    }
    if (!enrichmentSectorByOrg.has(row.organisation_id)) {
      const sector = row.sector?.trim();
      if (sector) {
        enrichmentSectorByOrg.set(row.organisation_id, {
          sector,
          sub_sector: row.sub_sector?.trim() || null,
        });
      }
    }
  }

  const activeOrgs = (organisationsRes.data ?? []).filter(
    (org) => !suppressedIds.has(org.id),
  );

  const incompleteRecords: IncompleteClientRecord[] = [];

  for (const org of activeOrgs) {
    const isRedactedEmail = containsRedactionPlaceholder(org.contact_email);
    const isRedactedWebsite = containsRedactionPlaceholder(org.website);
    const isRedactedSector =
      containsRedactionPlaceholder(org.sector) ||
      containsRedactionPlaceholder(org.sub_sector);
    const isRedactedCity =
      containsRedactionPlaceholder(org.city) ||
      containsRedactionPlaceholder(org.address_line_1) ||
      containsRedactionPlaceholder(org.postcode);

    const storedMission =
      org.charity_activities?.trim() ||
      org.cic_community_statement?.trim() ||
      enrichmentMissionByOrg.get(org.id) ||
      null;

    const isRedactedMission = containsRedactionPlaceholder(storedMission);
    const isRedactedName =
      containsRedactionPlaceholder(org.legal_name) ||
      containsRedactionPlaceholder(org.trading_name);

    const redactedFields: string[] = [];
    if (isRedactedEmail) redactedFields.push("email");
    if (isRedactedWebsite) redactedFields.push("website");
    if (isRedactedMission) redactedFields.push("mission");
    if (isRedactedSector) redactedFields.push("sector");
    if (isRedactedCity) redactedFields.push("city");
    if (isRedactedName) redactedFields.push("name");
    if (containsRedactionPlaceholder(org.address_line_1) && !redactedFields.includes("city")) {
      redactedFields.push("address");
    }

    const hasRedacted = redactedFields.length > 0;

    const hasSector = Boolean(
      org.sector &&
      org.sector.trim().length > 0 &&
      org.sector.toLowerCase() !== "unclassified" &&
      !isRedactedSector,
    );

    const hasMission = Boolean(storedMission && storedMission.length > 0 && !isRedactedMission);
    // An empty website is a gap unless somebody has recorded that this client
    // genuinely has no website — the mark of 20261018090000. It is cleared by
    // the database as soon as a website is on file, so a record cannot hold both.
    const websiteAbsentAt = org.website_absent_at ?? null;
    const hasWebsite = Boolean(
      (org.website && org.website.trim().length > 0 && !isRedactedWebsite) ||
        websiteAbsentAt,
    );
    const hasEmail = Boolean(org.contact_email && org.contact_email.trim().length > 0 && !isRedactedEmail);
    const hasCity = Boolean(org.city && org.city.trim().length > 0 && !isRedactedCity);
    const isIncomplete =
      !hasSector ||
      !hasMission ||
      !hasWebsite ||
      !hasEmail ||
      !hasCity ||
      hasRedacted;

    if (isIncomplete) {
      incompleteRecords.push({
        id: org.id,
        legal_name: org.legal_name,
        organisation_type: org.organisation_type,
        city: org.city,
        postcode: org.postcode,
        country_code: org.country_code,
        sector: org.sector,
        sub_sector: org.sub_sector,
        website: org.website,
        contact_email: org.contact_email,
        mission: storedMission,
        hasMission,
        hasSector,
        hasWebsite,
        websiteAbsentAt,
        hasEmail,
        hasCity,
        hasRedacted,
        redactedFields,
        isIncomplete,
        suggested_sector: null,
        suggested_sub_sector: null,
        charity_number: null,
        company_number: null,
      });
    }
  }

  // Sector suggestions for records that have none: the pipeline may have
  // classified the organisation even though nothing was ever written back to
  // the record. Attached for review-and-apply on the card, never auto-filled.
  for (const record of incompleteRecords) {
    if (record.hasSector) continue;
    const suggestion = enrichmentSectorByOrg.get(record.id);
    if (suggestion) {
      record.suggested_sector = suggestion.sector;
      record.suggested_sub_sector = suggestion.sub_sector;
    }
  }

  // Register numbers behind each card's "check the source" links — the only
  // way to answer a missing sector or mission from its origin rather than
  // memory. Chunked `.in()` rather than a whole-table read: only the
  // incomplete set needs numbers, and a thousands-long id list would blow
  // past URL limits. Fail-soft: without numbers the cards simply offer no
  // register link.
  if (incompleteRecords.length > 0) {
    const charityNumberByOrg = new Map<string, string>();
    const companyNumberByOrg = new Map<string, string>();
    const ids = incompleteRecords.map((record) => record.id);
    const CHUNK_SIZE = 200;
    for (let start = 0; start < ids.length; start += CHUNK_SIZE) {
      const { data, error } = await supabase
        .from("organisation_identifiers")
        .select("organisation_id, identifier_type, identifier_value")
        .in("organisation_id", ids.slice(start, start + CHUNK_SIZE))
        .in("identifier_type", ["uk_charity", "uk_company"])
        .overrideTypes<IdentifierRow[], { merge: false }>();
      if (error) {
        await reportError(error, {
          operation: "admin.incomplete_records.identifiers",
        });
        break;
      }
      for (const row of data ?? []) {
        const value = row.identifier_value?.trim();
        if (!value) continue;
        if (row.identifier_type === "uk_charity" && !charityNumberByOrg.has(row.organisation_id)) {
          charityNumberByOrg.set(row.organisation_id, value);
        } else if (
          row.identifier_type === "uk_company" &&
          !companyNumberByOrg.has(row.organisation_id)
        ) {
          companyNumberByOrg.set(row.organisation_id, value);
        }
      }
    }
    for (const record of incompleteRecords) {
      record.charity_number = charityNumberByOrg.get(record.id) ?? null;
      record.company_number = companyNumberByOrg.get(record.id) ?? null;
    }
  }

  const primaryIncompleteCount = incompleteRecords.length;
  const totalActiveCount = activeOrgs.length;

  // The history tab is about the records currently in this queue. Read the
  // existing append-only audit trail in id-sized chunks so a long queue does
  // not create an oversized PostgREST URL. Fail soft: the records remain
  // usable if history is temporarily unavailable.
  const auditRows: AuditRow[] = [];
  let auditHistoryDegraded = false;
  const incompleteIds = incompleteRecords.map((record) => record.id);
  const auditOrganisationNames = new Map(
    incompleteRecords.map((record) => [record.id, record.legal_name]),
  );
  const AUDIT_ID_CHUNK_SIZE = 200;
  for (let start = 0; start < incompleteIds.length; start += AUDIT_ID_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from("audit_log")
      .select("id, actor_user_id, action, target_table, target_id, detail, created_at")
      .eq("target_table", "organisations")
      .in("target_id", incompleteIds.slice(start, start + AUDIT_ID_CHUNK_SIZE))
      .order("created_at", { ascending: false })
      .overrideTypes<AuditRow[], { merge: false }>();
    if (error) {
      auditHistoryDegraded = true;
      await reportError(error, { operation: "admin.incomplete_records.audit_log" });
      continue;
    }
    auditRows.push(...(data ?? []));
  }

  const auditActorIds = Array.from(
    new Set(auditRows.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id))),
  );
  const auditPeople = new Map<string, string>();
  if (auditActorIds.length > 0) {
    const { data, error } = await supabase
      .from("users")
      .select("id, full_name, email")
      .in("id", auditActorIds);
    if (error) {
      auditHistoryDegraded = true;
      await reportError(error, { operation: "admin.incomplete_records.audit_log_people" });
    }
    for (const person of data ?? []) {
      auditPeople.set(person.id, person.full_name?.trim() || person.email);
    }
  }

  const auditNow = new Date();
  const auditHistory = groupByDay(
    auditRows
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((row) =>
        describeAuditEvent(
          row,
          {
            user: (id) => auditPeople.get(id) ?? null,
            organisation: (id) => auditOrganisationNames.get(id) ?? null,
          },
          auditNow,
        ),
      ),
  );

  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="mx-auto w-full max-w-[1400px] space-y-10">
        <Rise>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-lead hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-[15px]" />
            Back to dashboard
          </Link>
          <h1 className="mt-4 font-body text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1] tracking-[-0.03em] text-ink">
            Incomplete records
          </h1>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
            Records missing a mission, sector, website, email, or location — or carrying
            redacted personal details that need replacing. Work them here — each card links
            to the registers the record came from, so a gap can be checked at its source
            rather than guessed.
          </p>
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${
                primaryIncompleteCount > 0 ? "bg-hold" : "bg-go"
              }`}
            />
            {primaryIncompleteCount === 0 ? (
              <span>Every active client record is complete.</span>
            ) : (
              <span>
                <span className="font-semibold tabular-nums text-ink">
                  {primaryIncompleteCount.toLocaleString()}
                </span>{" "}
                of{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {totalActiveCount.toLocaleString()}
                </span>{" "}
                active client records {primaryIncompleteCount === 1 ? "needs" : "need"} work
              </span>
            )}
          </p>
        </Rise>

        <Group>
          <Rise>
            <IncompleteRecordsPanel
              initialRecords={incompleteRecords}
              canEdit={canEdit}
              auditHistory={auditHistory}
              auditHistoryDegraded={auditHistoryDegraded}
            />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
