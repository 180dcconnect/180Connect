import { redirect } from "next/navigation";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission, isViewOnly } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchPaged } from "@/lib/supabase/fetch-paged";
import { reportError } from "@/lib/error-logging";
import { BackButton } from "@/components/ui/back-button";
import { IncompleteRecordsPanel } from "./incomplete-records-panel";
import type { IncompleteClientRecord } from "./types";

type RawOrgRow = {
  id: string;
  legal_name: string;
  organisation_type: string;
  city: string | null;
  country_code: string;
  sector: string | null;
  sub_sector: string | null;
  website: string | null;
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
  enriched_at: string;
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
            "id, legal_name, organisation_type, city, country_code, sector, sub_sector, website, contact_email, charity_activities, cic_community_statement, outreach_status",
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
    supabase
      .from("enrichment_results")
      .select("organisation_id, mission_statement, enriched_at")
      .not("mission_statement", "is", null)
      .order("enriched_at", { ascending: false })
      .overrideTypes<EnrichmentRow[], { merge: false }>(),
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
  for (const row of enrichmentRes.data ?? []) {
    if (row.mission_statement?.trim() && !enrichmentMissionByOrg.has(row.organisation_id)) {
      enrichmentMissionByOrg.set(row.organisation_id, row.mission_statement.trim());
    }
  }

  const activeOrgs = (organisationsRes.data ?? []).filter(
    (org) => !suppressedIds.has(org.id),
  );

  const incompleteRecords: IncompleteClientRecord[] = [];

  for (const org of activeOrgs) {
    const hasSector = Boolean(
      org.sector &&
      org.sector.trim().length > 0 &&
      org.sector.toLowerCase() !== "unclassified",
    );

    const storedMission =
      org.charity_activities?.trim() ||
      org.cic_community_statement?.trim() ||
      enrichmentMissionByOrg.get(org.id) ||
      null;

    const hasMission = Boolean(storedMission && storedMission.length > 0);
    const hasWebsite = Boolean(org.website && org.website.trim().length > 0);
    const hasEmail = Boolean(org.contact_email && org.contact_email.trim().length > 0);
    const isIncomplete = !hasSector || !hasMission || !hasWebsite;

    if (isIncomplete || !hasEmail) {
      incompleteRecords.push({
        id: org.id,
        legal_name: org.legal_name,
        organisation_type: org.organisation_type,
        city: org.city,
        country_code: org.country_code,
        sector: org.sector,
        sub_sector: org.sub_sector,
        website: org.website,
        contact_email: org.contact_email,
        mission: storedMission,
        hasMission,
        hasSector,
        hasWebsite,
        hasEmail,
        isIncomplete,
      });
    }
  }

  const primaryIncompleteCount = incompleteRecords.filter((r) => r.isIncomplete).length;
  const missingMissionCount = incompleteRecords.filter((r) => !r.hasMission).length;
  const missingSectorCount = incompleteRecords.filter((r) => !r.hasSector).length;
  const missingWebsiteCount = incompleteRecords.filter((r) => !r.hasWebsite).length;

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl">
        {/* Navigation back */}
        <div className="mb-4">
          <BackButton href="/admin" label="All admin tools" size="sm" />
        </div>

        {/* Header Block */}
        <header className="rounded-panel border border-rule bg-white p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-dim">
              Admin workspace · Data quality
            </span>
          </div>

          <h1 className="mt-2 text-2xl font-bold text-ink">Incomplete client records</h1>
          <p className="mt-2 text-sm text-dim leading-relaxed max-w-3xl">
            Client records that lack vital outreach foundations — mission statements, sectors, or
            websites. Complete records inline to ensure CAMs have the context needed to personalize
            consultancy proposals and reach out effectively.
          </p>

          {/* Queue Fact Rail */}
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule-soft pt-4 text-xs font-medium text-dim">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${
                  primaryIncompleteCount > 0 ? "bg-hold" : "bg-go"
                }`}
              />
              <span className="font-semibold tabular-nums text-ink">
                {primaryIncompleteCount.toLocaleString()}
              </span>
              <span>{primaryIncompleteCount === 1 ? "record requires" : "records require"} completion</span>
            </div>

            <span aria-hidden="true" className="text-rule">·</span>

            <div className="flex items-center gap-1">
              <span className="font-semibold tabular-nums text-ink">
                {missingMissionCount.toLocaleString()}
              </span>
              <span>missing mission</span>
            </div>

            <span aria-hidden="true" className="text-rule">·</span>

            <div className="flex items-center gap-1">
              <span className="font-semibold tabular-nums text-ink">
                {missingSectorCount.toLocaleString()}
              </span>
              <span>missing sector</span>
            </div>

            <span aria-hidden="true" className="text-rule">·</span>

            <div className="flex items-center gap-1">
              <span className="font-semibold tabular-nums text-ink">
                {missingWebsiteCount.toLocaleString()}
              </span>
              <span>missing website</span>
            </div>
          </div>
        </header>

        {/* Cleaning Panel */}
        <IncompleteRecordsPanel
          initialRecords={incompleteRecords}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
