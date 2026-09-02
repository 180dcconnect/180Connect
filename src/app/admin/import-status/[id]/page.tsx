import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle } from "lucide-react";

import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Group, Rise } from "@/components/dashboard-stage";
import { StatusBadge } from "../status-badge";
import {
  describeRun,
  formatSource,
  type IngestionRunRow,
} from "../run-format";
import type { OrganisationPreview } from "@/lib/recent-updates";
import {
  describeRawRecord,
  type RawSourceRecordRow,
} from "./record-format";
import { RecordFeed } from "./record-feed";

type PageParams = Promise<{ id: string }>;

type OrganisationRow = {
  id: string;
  legal_name: string;
  organisation_type: string | null;
  sector: string | null;
  city: string | null;
  country_code: string | null;
  outreach_status: string;
  website: string | null;
  owner_id: string | null;
};

export default async function IngestionRunDetailPage({
  params,
}: {
  params: PageParams;
}) {
  const authorization = await getCurrentActor("platform-settings:manage", {
    route: "/admin/import-status",
  });
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const { id } = await params;
  const supabase = await createClient();

  // Fetch the ingestion run
  const { data: runData, error: runError } = await supabase
    .from("ingestion_runs")
    .select(
      "id, api_source, job_status, records_fetched, records_inserted, records_skipped, records_failed, records_flagged, started_at, completed_at, error_message",
    )
    .eq("id", id)
    .maybeSingle();

  if (runError) {
    await reportError(runError, { operation: "admin.import_status.get_run", runId: id });
  }

  if (!runData) {
    notFound();
  }

  const runRow = runData as IngestionRunRow;
  const now = new Date();
  const runView = describeRun(runRow, now);

  // Fetch raw records from this run
  const { data: rawRecords, error: rawError } = await supabase
    .from("raw_source_records")
    .select(
      "id, ingestion_run_id, record_source, source_record_id, raw_payload, received_at, processing_status, matched_organisation_id, checksum, ingestion_attempt, source_country, source_registry_name, excluded_fields, rule_version_applied",
    )
    .eq("ingestion_run_id", id)
    .order("received_at", { ascending: false });

  if (rawError) {
    await reportError(rawError, { operation: "admin.import_status.get_raw_records", runId: id });
  }

  const rows = (rawRecords ?? []) as RawSourceRecordRow[];

  // Fetch matched organisation details for any promoted/matched records
  const matchedOrgIds = Array.from(
    new Set(rows.map((r) => r.matched_organisation_id).filter((id): id is string => Boolean(id))),
  );

  const orgMap = new Map<string, OrganisationPreview>();

  if (matchedOrgIds.length > 0) {
    const { data: orgData } = await supabase
      .from("organisations")
      .select("id, legal_name, organisation_type, sector, city, country_code, outreach_status, website, owner_id")
      .in("id", matchedOrgIds);

    const orgRows = (orgData ?? []) as OrganisationRow[];
    for (const org of orgRows) {
      orgMap.set(org.id, {
        id: org.id,
        legalName: org.legal_name,
        organisationType: org.organisation_type,
        sector: org.sector,
        city: org.city,
        countryCode: org.country_code,
        outreachStatus: org.outreach_status,
        website: org.website,
        ownerId: org.owner_id,
        ownerName: null,
        ownerEmail: null,
      });
    }
  }

  const recordViews = rows.map((row) =>
    describeRawRecord(row, row.matched_organisation_id ? orgMap.get(row.matched_organisation_id) ?? null : null, now),
  );

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Back link & breadcrumbs */}
        <Rise>
          <Link
            href="/admin/import-status"
            className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground/60 hover:text-brand transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Import Status</span>
          </Link>
        </Rise>

        {/* Heading & Run Overview */}
        <Rise className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold font-body text-foreground">
                {formatSource(runRow.api_source)} Import
              </h1>
              <StatusBadge status={runRow.job_status} />
            </div>
            <span className="font-mono text-xs text-foreground/45">
              Run #{runRow.id.slice(0, 8)}
            </span>
          </div>

          <p className="text-sm leading-[1.6] text-foreground/75">
            {runView.summary} · Started {runView.startedRelative} ({runView.startedExact}) · Duration: {runView.duration}
          </p>
        </Rise>

        {/* Error Callout if failed */}
        {runView.humanError && (
          <Rise>
            <div className="rounded-2xl border border-red-200/80 bg-red-50/80 p-5">
              <div className="flex items-start gap-3.5">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700">
                  <AlertCircle className="h-5 w-5" strokeWidth={2.2} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-red-950">
                    {runView.humanError.summary}
                  </h3>
                  <p className="mt-1 text-sm leading-[1.6] text-red-900/85">
                    {runView.humanError.description}
                  </p>
                  {runView.humanError.actionHint && (
                    <div className="mt-3 inline-flex items-start gap-1.5 rounded-lg bg-white/95 px-3.5 py-2 text-xs text-red-950 shadow-2xs ring-1 ring-red-200/70">
                      <span className="font-bold">How to fix:</span>
                      <span>{runView.humanError.actionHint}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Rise>
        )}

        {/* 5-Count Outcome Stats Header Cards */}
        <Rise>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {runView.counts.map((count) => (
              <div
                key={count.label}
                className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-2xs"
              >
                <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/40">
                  {count.label}
                </dt>
                <dd className="mt-1 text-2xl font-black tabular-nums text-foreground">
                  {count.value.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
        </Rise>

        {/* Individual Records Feed */}
        <Group className="space-y-4">
          <Rise className="flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-foreground">
                Imported Organisations &amp; Filing Breakdown
              </h2>
              <p className="text-xs text-foreground/60">
                Review organisations retrieved from the official register, check filing status, and view active client profiles in 180Connect.
              </p>
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-foreground/40 tabular-nums">
              {recordViews.length} organisation{recordViews.length === 1 ? "" : "s"} listed
            </p>
          </Rise>

          <Rise>
            <RecordFeed
              records={recordViews}
              source={formatSource(runRow.api_source)}
              recordsSkipped={runRow.records_skipped}
            />
          </Rise>
        </Group>
      </div>
    </div>
  );
}
