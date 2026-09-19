// One import run, in full: what it did, and every record it touched.
//
// ── The layout ──
//
// Filed Record (`docs/app-design-system.md`), with the structure the Data
// imports screens use: a heading block with a rail of facts under it, then a
// card per question, in the order the questions are asked —
//
//   1. What went wrong, when something did. Nothing else on the page matters
//      until that is read, so it sits above the counts rather than under them.
//   2. What the run did — the counts, and the share of what it fetched that
//      reached the client list.
//   3. The records themselves, searched and filtered from the bar on the rail.
//
// The search bar is the one from `/clients` and `/admin/import-status`
// (`BrandSearchBar` on a `SearchRail`), not a box of its own: a CAM who has
// learned to search the client list should not have to learn a second search.
// It writes its query and filters to the URL, so this page filters on the
// server and `RecordFeed` is left to render rows.
//
// ── Who sees it ──
//
// Gated on `platform-settings:manage` through `getViewingActor`, so leadership
// (`viewer`) reaches it. Everything here is reading — there is no control to
// withhold from them, and withholding the numbers would be the opposite
// mistake (AGENTS.md, "Keep the reading").
//
// The root element is a `div`, not a `main`: the admin layout's AppShell
// already renders the `main` this is slotted into.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";

import { getViewingActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Group, Rise } from "@/components/dashboard-stage";
import { SearchRail } from "@/components/search-rail";
import { BrandSearchBar } from "@/components/brand/search-bar";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { Key, Pill } from "@/app/(app)/clients/[id]/section-card";
import {
  describeRun,
  formatSource,
  type IngestionRunRow,
  type RunCount,
  type RunTone,
} from "../run-format";
import type { OrganisationPreview } from "@/lib/recent-updates";
import {
  describeRawRecord,
  isRecordSortField,
  matchesRecordFilters,
  matchesRecordQuery,
  recordFilterOptions,
  sortRecords,
  type RawRecordView,
  type RawSourceRecordRow,
  type RecordFilters,
  type RecordSortField,
} from "./record-format";
import { RecordFeed } from "./record-feed";

type PageParams = Promise<{ id: string }>;

/** Next.js 16: searchParams is a Promise, as on `/admin/import-status`. */
type SearchParams = Promise<{
  q?: string;
  status?: string | string[];
  place?: string | string[];
  kind?: string | string[];
  link?: string | string[];
  details?: string | string[];
  sort?: string;
  dir?: string;
}>;

/** Category label → the query parameter it writes, for the shared search bar. */
const FILTER_PARAMS = {
  "Filter by outcome": "status",
  "Filter by place": "place",
  "Filter by client type": "kind",
  "Filter by client link": "link",
  "Filter by personal details": "details",
} as const;

const LINK_OPTIONS = [
  { label: "On the client list", value: "linked" },
  { label: "Not on the client list", value: "unlinked" },
];

const DETAIL_OPTIONS = [
  { label: "Personal details removed", value: "removed" },
  { label: "Nothing removed", value: "kept" },
];

/**
 * The orders on offer, each naming its own two directions in the words that
 * fit it. "Ascending" on a date means nothing to a reader; "Oldest first" is
 * the same instruction, already translated.
 *
 * The run's own order — most recently read first — is the default, because
 * that is the order the import wrote them in.
 */
const SORT_OPTIONS: {
  label: string;
  value: RecordSortField;
  ascLabel: string;
  descLabel: string;
}[] = [
  { label: "When it was read", value: "read", ascLabel: "Oldest first", descLabel: "Newest first" },
  { label: "Name", value: "name", ascLabel: "A to Z", descLabel: "Z to A" },
  {
    label: "What happened to it",
    value: "outcome",
    ascLabel: "Added first",
    descLabel: "Problems first",
  },
  { label: "Town", value: "place", ascLabel: "A to Z", descLabel: "Z to A" },
];

/**
 * The screen a run of this source is started from, for "Run this again".
 * Sources with no import screen of their own — a scheduled recheck, a
 * backfill — are absent, and no button is offered for them.
 */
const IMPORT_SCREEN: Record<string, string> = {
  charity_commission: "/admin/charity-commission",
  charity_commission_bulk: "/admin/charity-commission",
  companies_house: "/admin/companies-house",
};

const DEFAULT_SORT: RecordSortField = "read";
const DEFAULT_DIRECTION = "desc";

function labelFor(
  options: { label: string; value: string }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** A repeated query parameter arrives as an array, a single one as a string. */
function asList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

/** The state tone a run's outcome wears, in this system's four tones. */
const PILL_TONE: Record<RunTone, "go" | "hold" | "stop" | "lead" | "neutral"> = {
  success: "go",
  warning: "hold",
  danger: "stop",
  info: "lead",
  neutral: "neutral",
};

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

/** One count from the run, in the settings screens' stat shape. */
/**
 * One count on the run's own card.
 *
 * A count that names the record statuses behind it becomes a way in: tapping it
 * filters the list below to exactly those records. "Needs a look: 6" was a
 * number with no way to reach the six, so the reader had to work out which
 * filter matched it — which is the reader doing the page's job. A count with
 * nothing behind it (nothing happened, or the records were never staged) stays
 * a plain tile rather than offering an empty list.
 */
function Stat({
  label,
  value,
  tone = "neutral",
  href,
}: {
  label: string;
  value: number;
  tone?: RunTone;
  href?: string;
}) {
  const valueClass = `mt-1 font-body text-[28px] leading-none font-light tabular-nums ${
    value > 0 && tone === "danger"
      ? "text-stop"
      : value > 0 && tone === "success"
        ? "text-go"
        : "text-ink"
  }`;

  const body = (
    <>
      <dt className="text-[13px] text-dim">{label}</dt>
      <dd className={valueClass}>{value.toLocaleString()}</dd>
      {href && (
        <p className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-lead">
          Show these
          <ArrowRight className="h-3 w-3" aria-hidden={true} />
        </p>
      )}
    </>
  );

  if (!href) {
    return <div className="rounded-inset bg-paper px-4 py-3">{body}</div>;
  }

  return (
    <Link
      href={href}
      className="block rounded-inset bg-paper px-4 py-3 transition-colors hover:bg-paper-sunk focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead"
      aria-label={`Show the ${value.toLocaleString()} ${label.toLowerCase()} records from this run`}
    >
      {body}
    </Link>
  );
}

export default async function IngestionRunDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const authorization = await getViewingActor("platform-settings:manage", {
    route: "/admin/import-status",
  });
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const { id } = await params;
  const query = await searchParams;
  const search = query.q?.trim() ?? "";
  const filters: RecordFilters = {
    status: asList(query.status),
    place: asList(query.place),
    kind: asList(query.kind),
    link: asList(query.link),
    details: asList(query.details),
  };
  // An order nobody asked for, or one from a link with a value this page no
  // longer offers, falls back to the run's own order rather than to nothing.
  const sortField: RecordSortField =
    query.sort && isRecordSortField(query.sort) ? query.sort : DEFAULT_SORT;
  const sortDirection = query.dir === "asc" ? "asc" : query.dir === "desc" ? "desc" : DEFAULT_DIRECTION;
  const supabase = await createClient();

  // The run and its raw records together: both are keyed on the route's `id`,
  // so the records read never needed the run to come back first. Only the
  // matched-organisation lookup further down genuinely depends on a result.
  // Raw records carry the full `raw_payload` JSON per row, so the feed is
  // capped at the 500 most recent — a large run would otherwise ship megabytes
  // of JSON in a single server render. The count below says how many are listed.
  const RAW_RECORD_WINDOW = 500;
  const [
    { data: runData, error: runError },
    { data: rawRecords, error: rawError, count: rawTotal },
  ] = await Promise.all([
    supabase
      .from("ingestion_runs")
      .select(
        // `run_stats` is not optional decoration: without it `describeRun`
        // cannot tell staged rows from clients added, and this page repeated
        // the staging counter as "added" while the client list said otherwise.
        "id, api_source, job_status, records_fetched, records_inserted, records_skipped, records_failed, records_flagged, started_at, completed_at, error_message, run_stats, triggered_by",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("raw_source_records")
      .select(
        "id, ingestion_run_id, record_source, source_record_id, raw_payload, received_at, processing_status, matched_organisation_id, checksum, ingestion_attempt, source_country, source_registry_name, excluded_fields, rule_version_applied",
        { count: "exact" },
      )
      .eq("ingestion_run_id", id)
      .order("received_at", { ascending: false })
      .limit(RAW_RECORD_WINDOW),
  ]);

  if (runError) {
    await reportError(runError, { operation: "admin.import_status.get_run", runId: id });
  }

  if (!runData) {
    notFound();
  }

  const runRow = runData as IngestionRunRow;
  const now = new Date();
  const runView = describeRun(runRow, now);

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
    // Chunked: a single `.in()` with thousands of ids risks URL/statement
    // limits, and the window above already bounds this to a few hundred.
    const ORG_LOOKUP_CHUNK = 200;
    for (let start = 0; start < matchedOrgIds.length; start += ORG_LOOKUP_CHUNK) {
      const { data: orgData, error: orgError } = await supabase
        .from("organisations")
        .select("id, legal_name, organisation_type, sector, city, country_code, outreach_status, website, owner_id")
        .in("id", matchedOrgIds.slice(start, start + ORG_LOOKUP_CHUNK));
      if (orgError) {
        await reportError(orgError, { operation: "admin.import_status.get_matched_orgs", runId: id });
        break;
      }

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
  }

  // Which of the rejected records are actually waiting for an admin, rather
  // than settled by the criteria. Both are stored as `rejected`, and the page
  // showed them as the same thing — so a record a human still has to answer
  // read as a closed decision. The review queue keeps the distinction in
  // `data_quality_events`, which is where this asks.
  const heldForReview = new Set<string>();
  const rejectedIds = rows
    .filter((row) => row.processing_status === "rejected")
    .map((row) => row.id);
  if (rejectedIds.length > 0) {
    const REVIEW_LOOKUP_CHUNK = 200;
    for (let start = 0; start < rejectedIds.length; start += REVIEW_LOOKUP_CHUNK) {
      const { data: events, error: eventsError } = await supabase
        .from("data_quality_events")
        .select("raw_source_record_id")
        .eq("rule_name", "client_criteria_needs_review")
        .eq("resolved", false)
        .in("raw_source_record_id", rejectedIds.slice(start, start + REVIEW_LOOKUP_CHUNK));
      if (eventsError) {
        // A failed lookup must not blank the page: without it every rejected
        // record reads as "did not meet the criteria", which is the older,
        // safer of the two labels rather than a wrong promise of a decision.
        await reportError(eventsError, {
          operation: "admin.import_status.get_review_events",
          runId: id,
        });
        break;
      }
      for (const event of (events ?? []) as { raw_source_record_id: string | null }[]) {
        if (event.raw_source_record_id) heldForReview.add(event.raw_source_record_id);
      }
    }
  }

  const recordViews = rows.map((row) =>
    describeRawRecord(
      row,
      row.matched_organisation_id ? orgMap.get(row.matched_organisation_id) ?? null : null,
      now,
      { heldForReview: heldForReview.has(row.id) },
    ),
  );

  const isGrantSource = runRow.api_source === "360giving";
  const thing = isGrantSource ? "grant" : "record";
  const things = isGrantSource ? "grants" : "records";

  // Free text is matched against the rendered record, not pushed at the
  // database: someone searching "held for review" is reading this page, which
  // is the only place those words exist. Filters are applied the same way, over
  // the same window.
  const visible: RawRecordView[] = sortRecords(
    recordViews.filter(
      (view) => matchesRecordFilters(view, filters) && matchesRecordQuery(view, search),
    ),
    sortField,
    sortDirection,
  );
  const filtersActive =
    Boolean(search) || Object.values(filters).some((values) => values && values.length > 0);

  // Options come from the records this run actually holds, so no filter offers
  // an answer that returns nothing — and a 360Giving run gets its own wording
  // without a second list being written here.
  const statusOptions = recordFilterOptions(recordViews, (view) => ({
    label: view.status.label,
    value: view.statusKey,
  }));
  const placeOptions = recordFilterOptions(recordViews, (view) => {
    const place = view.city ?? view.postcode;
    return place ? { label: place, value: place } : null;
  });
  const kindOptions = recordFilterOptions(recordViews, (view) =>
    view.filingType ? { label: view.filingType, value: view.filingType } : null,
  );

  /**
   * Where a count's card goes: this same page, filtered to the records the
   * count is made of. Built on the reader's current view rather than replacing
   * it — their search, sort and other filters survive the tap, because a card
   * that silently discarded them would be a worse answer than the number was.
   */
  const filterHref = (count: RunCount): string | undefined => {
    if (!count.statusKeys || count.statusKeys.length === 0 || count.value === 0) {
      return undefined;
    }
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    for (const value of filters.place ?? []) params.append("place", value);
    for (const value of filters.kind ?? []) params.append("kind", value);
    for (const value of filters.details ?? []) params.append("details", value);
    if (query.sort) params.set("sort", query.sort);
    if (query.dir) params.set("dir", query.dir);
    for (const key of count.statusKeys) params.append("status", key);
    return `/admin/import-status/${id}?${params.toString()}`;
  };

  // The share of what the run fetched that reached the client list. One reading
  // in the accent, not a segment per outcome: outcomes are state, and state is
  // the pill's job (`docs/app-design-system.md`, "The sticks").
  const addedCount =
    runView.headline.find((count) => count.label === "Added to the client list")?.value ?? 0;
  const fetchedCount =
    runView.details.find((count) => count.label === "From the register")?.value ?? 0;
  // Adding works through everything waiting, not only this run's own records,
  // so on the run that clears a backlog `added` can exceed what this run read.
  // The gauge would then read as more than full, which is nonsense; it is a
  // share of this run's own records, so it only renders when it is one.
  const gaugeApplies = fetchedCount > 0 && addedCount <= fetchedCount;

  // "Run this again" is only honest where the run recorded what it looked for
  // and there is a screen to reopen it on. It is a link to that screen, not an
  // import: repeating one is a bulk write to the client list, so the criteria
  // and the live count are put in front of the reader first. Withheld from
  // leadership, whose press the import action would refuse anyway.
  const repeatHref =
    runView.criteriaSentence && IMPORT_SCREEN[runRow.api_source]
      ? `${IMPORT_SCREEN[runRow.api_source]}?again=${runRow.id}`
      : null;
  const canRepeat = hasPermission(authorization.actor.role, "client:edit");

  // The order, said where the rows are. The control that set it lives on the
  // search bar, which is a different part of the screen.
  const sortOption = SORT_OPTIONS.find((option) => option.value === sortField) ?? SORT_OPTIONS[0];
  const orderNote = `${sortOption.label} · ${
    sortDirection === "asc" ? sortOption.ascLabel : sortOption.descLabel
  }`;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <SearchRail
        className="max-w-6xl"
        stageClassName="space-y-8"
        heading={
          <div>
            <Link
              href="/admin/import-status"
              className="inline-flex items-center gap-1.5 text-[13px] text-dim transition-colors hover:text-ink"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              <span>Import status</span>
            </Link>

            <h1 className="mt-3 font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
              {formatSource(runRow.api_source)} import
            </h1>

            {/* The rail of facts: the run's outcome, then when it ran, how long
                it took, what started it, and its reference — the things someone
                arriving from the history needs before reading a single row. */}
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px] text-dim">
              <Pill tone={PILL_TONE[runView.tone]}>{runView.statusLabel}</Pill>
              <span>
                Started {runView.startedRelative} ({runView.startedExact})
              </span>
              <span aria-hidden className="text-faint">
                ·
              </span>
              <span>Took {runView.duration}</span>
              {runView.triggerLabel && (
                <>
                  <span aria-hidden className="text-faint">
                    ·
                  </span>
                  <span>
                    {runView.triggerLabel === "Manual"
                      ? "Started by a person"
                      : "Started on a schedule"}
                  </span>
                </>
              )}
              <span aria-hidden className="text-faint">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Key>Run</Key>
                <span className="font-mono text-[12px] text-faint">
                  {runRow.id.slice(0, 8)}
                </span>
              </span>
            </div>

            <p className="mt-3 text-sm leading-[1.65] text-dim">{runView.summary}</p>
          </div>
        }
        bar={
          <BrandSearchBar
            tone="light"
            placeholder={`Search the ${things} for`}
            subjects={
              isGrantSource
                ? ["funders", "recipients", "grant IDs", "amounts"]
                : ["clients", "charity numbers", "towns", "outcomes"]
            }
            defaultQuery={search}
            params={FILTER_PARAMS}
            sort={{
              param: "sort",
              directionParam: "dir",
              value: sortField,
              direction: sortDirection,
              options: SORT_OPTIONS,
            }}
            defaultFilters={[
              ...(filters.status ?? []).map((value) => ({
                category: "Filter by outcome",
                label: labelFor(statusOptions, value),
                value,
              })),
              ...(filters.place ?? []).map((value) => ({
                category: "Filter by place",
                label: value,
                value,
              })),
              ...(filters.kind ?? []).map((value) => ({
                category: "Filter by client type",
                label: value,
                value,
              })),
              ...(filters.link ?? []).map((value) => ({
                category: "Filter by client link",
                label: labelFor(LINK_OPTIONS, value),
                value,
              })),
              ...(filters.details ?? []).map((value) => ({
                category: "Filter by personal details",
                label: labelFor(DETAIL_OPTIONS, value),
                value,
              })),
            ]}
            // A category with nothing in it is a row that opens onto an empty
            // list, so one that this run cannot fill is not offered at all.
            categories={{
              ...(statusOptions.length > 0 ? { "Filter by outcome": statusOptions } : {}),
              ...(placeOptions.length > 0 ? { "Filter by place": placeOptions } : {}),
              ...(kindOptions.length > 0 ? { "Filter by client type": kindOptions } : {}),
              ...(recordViews.length > 0
                ? {
                    "Filter by client link": LINK_OPTIONS,
                    "Filter by personal details": DETAIL_OPTIONS,
                  }
                : {}),
            }}
          />
        }
      >
        {runView.humanError && (
          <Rise>
            <section className="rounded-panel border border-stop/25 bg-stop-wash/60 px-5 py-5 sm:px-6">
              <h2 className="flex items-center gap-2 font-body text-[19px] leading-[1.3] font-normal tracking-[-0.01em] text-ink">
                <AlertCircle aria-hidden="true" className="size-[15px] text-stop" />
                {runView.humanError.summary}
              </h2>
              <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
                {runView.humanError.description}
              </p>
              {runView.humanError.actionHint && (
                <p className="mt-4 rounded-inset bg-white px-4 py-3 text-[13px] leading-[1.55] text-ink">
                  <span className="font-semibold">What to do next: </span>
                  {runView.humanError.actionHint}
                </p>
              )}
            </section>
          </Rise>
        )}

        <Group className="space-y-6">
          <Rise>
            <section
              aria-labelledby="run-outcome-heading"
              className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6"
            >
              <h2
                id="run-outcome-heading"
                className="font-body text-[19px] leading-[1.3] font-normal tracking-[-0.01em] text-ink"
              >
                What this run did
              </h2>
              <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
                {runView.summary}
              </p>

              {/* Three numbers, and only three: did clients get added, how
                  many were already here, is anything waiting on someone. The
                  per-stage breakdown that used to sit under this asked a
                  reader to hold five near-identical numbers in mind to answer
                  a question the third one already answers — and "Needs a look"
                  leads to the records themselves, which is where the answer
                  actually is. */}
              <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {runView.headline.map((count) => (
                  <Stat
                    key={count.label}
                    label={count.label}
                    value={count.value}
                    tone={count.tone}
                    href={filterHref(count)}
                  />
                ))}
              </dl>

              {runView.criteriaSentence && (
                <div className="mt-4 rounded-inset bg-paper px-4 py-3">
                  <p className="text-[12.5px] text-dim">What this run looked for</p>
                  <p className="mt-0.5 text-[13.5px] leading-[1.55] text-ink">
                    {runView.criteriaSentence}
                  </p>
                  {repeatHref && canRepeat && (
                    <Link
                      href={repeatHref}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-inset border border-lead bg-lead px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
                    >
                      <RotateCcw aria-hidden="true" className="size-3.5" />
                      Run this again
                    </Link>
                  )}
                  {repeatHref && canRepeat && (
                    <p className="mt-1.5 text-[12.5px] leading-[1.5] text-dim">
                      Opens the import screen with these criteria loaded. Nothing is
                      imported until you press Import there.
                    </p>
                  )}
                </div>
              )}

              {gaugeApplies && (
                <div className="mt-5">
                  <p className="text-[13px] leading-[1.55] text-dim">
                    <span className="font-semibold text-ink tabular-nums">
                      {addedCount.toLocaleString()}
                    </span>{" "}
                    of the {fetchedCount.toLocaleString()} {things} this run read from the
                    source reached the client list.
                  </p>
                  <div className="mt-3">
                    <HorizontalStickGauge
                      checked={Math.min(addedCount, fetchedCount)}
                      total={fetchedCount}
                      ariaLabel="Share of this run's records added to the client list"
                      checkedLabel="Added"
                      remainingLabel="Not added"
                      stickHeight={12}
                    />
                  </div>
                </div>
              )}

              {runRow.records_skipped > 0 && (
                <p className="mt-4 rounded-inset bg-paper px-4 py-3 text-[13px] leading-[1.55] text-ink">
                  <span className="font-semibold tabular-nums">
                    {runRow.records_skipped.toLocaleString()}
                  </span>{" "}
                  {runRow.records_skipped === 1 ? thing : things} were already held and
                  unchanged since the last import, so nothing needed saving for{" "}
                  {runRow.records_skipped === 1 ? "it" : "them"}.
                </p>
              )}
            </section>
          </Rise>

          <Rise>
            <RecordFeed
              records={visible}
              isGrantSource={isGrantSource}
              filtersActive={filtersActive}
              orderNote={orderNote}
              listedTotal={recordViews.length}
              runTotal={typeof rawTotal === "number" ? rawTotal : recordViews.length}
              windowSize={RAW_RECORD_WINDOW}
            />
          </Rise>
        </Group>
      </SearchRail>
    </div>
  );
}
