import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Group, Rise, Stage } from "@/components/dashboard-stage";

import { FinancialsHeroCard } from "./financials-hero-card";
import { FinancialFilingsSection } from "../financial-filings-section";
import {
  FINANCIAL_FILINGS_PAGE_SIZE,
  type FinancialFilingRow,
} from "../financial-filing-item";
import { GrantHistorySection } from "../grant-history-section";
import { GRANT_HISTORY_PAGE_SIZE, type GrantRow } from "../grant-list-item";
import {
  loadClient,
  loadIdentifiers,
  loadSources,
  requireActor,
} from "../load-record";
import { loadOperatingGeography } from "@/lib/operating-geography";
import {
  buildFinancialSeries,
  buildFundFlows,
  explainMissingAccounts,
  type FinancialPeriodInput,
} from "@/lib/financials/financial-series";
import type { FunderGrantInput } from "@/lib/financials/funders";
import {
  sectorPeerStatsFromDistribution,
  type SectorDistributionRow,
} from "@/lib/financials/sector-peers";
import { NoAccountsNotice } from "./no-accounts-notice";
import { SectionCard } from "../section-card";
import { SectionUnavailable } from "./section-unavailable";
import {
  FinancialHistoryChart,
  IncomeMixPanel,
  YearOnYearGrantsChart,
} from "./financial-history-chart";
import { FundFlowSankey } from "./fund-flow-sankey";
import { FundingProfile } from "./funding-profile";
import { WhoDoesTheWork } from "./who-does-the-work";
import { WhyNowStrip } from "./why-now-strip";

/** Charity Commission publishes five filed years; the cap is headroom, not a
 *  page size — a client with more is a client whose whole history we want. */
const CHART_PERIOD_LIMIT = 20;
/** The widest grant history in the book is under 300 awards. */
const CHART_GRANT_LIMIT = 500;

type GrantRowQuery = Pick<
  GrantRow,
  | "id"
  | "funder_name"
  | "amount_awarded"
  | "currency"
  | "award_date"
  | "grant_programme"
  | "description"
>;

/**
 * F035 grant history + F041 financial filings — the **Financials** tab.
 *
 * The two belong together and nowhere near the top of the record: grants are
 * funding this client has received, filings are its own accounts, so "what came
 * in, and what it reports" reads as one pass. On the old single page they sat
 * third and fourth in the left column, pushing notes and attachments below two
 * paginated tables that most visits never looked at. Giving them their own tab
 * is also what takes their two `{ count: "exact" }` queries off every other
 * visit to the record.
 *
 * Both are full width rather than columned: they are tables, and a table in a
 * two-thirds column wraps its money columns.
 *
 * Only the first page is fetched here; later pages come from the colocated
 * `loadMoreGrants` / `loadMoreFinancialFilings` actions, which repeat this exact
 * ordering — the id tiebreaker is what keeps the offset pagination
 * deterministic when rows share a date.
 */
/**
 * The same-sector income distribution, in one round trip.
 *
 * All the work is `get_sector_income_distribution` (migration 20260916090000):
 * picking one income per peer is a max-per-group, PostgREST cannot express
 * DISTINCT ON, and the version of this that did the reduction in Node pulled
 * every same-sector organisation id and then every financial_periods row behind
 * them — ~1,750 rows on the largest sector, to produce six numbers.
 *
 * The RPC is SECURITY INVOKER, so a deactivated caller gets the same nothing
 * here as everywhere else rather than a special case.
 *
 * Failures degrade to null rather than being reported: the peer strip is the
 * least important thing on this tab and must never be the reason the page
 * errors. A sector we simply hold no other clients in is the same shape as a
 * failure to the caller — an absent strip — and is not worth an error row.
 */
async function loadSectorDistribution(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  sector: string,
  income: number | null,
): Promise<SectorDistributionRow | null> {
  const { data, error } = await supabase.rpc("get_sector_income_distribution", {
    p_sector: sector,
    p_exclude_organisation_id: organisationId,
    p_income: income,
  });
  if (error) return null;
  // Cast rather than `.returns<>()`: the client is untyped (no generated
  // `Database`), so the builder defaults to a single-object shape and the
  // generic fights it. Same pattern as the other table-returning RPC call
  // sites — see admin/team-pipeline/page.tsx.
  const rows = (data ?? []) as SectorDistributionRow[];
  return rows[0] ?? null;
}

export default async function ClientFinancialsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireActor();
  const supabase = await createClient();

  const [grants, filings, chartData] = await Promise.all([
    supabase
      .from("grants")
      .select(
        "id, funder_name, amount_awarded, currency, award_date, grant_programme, description",
        { count: "exact" },
      )
      .eq("organisation_id", id)
      .order("award_date", { ascending: false })
      .order("id", { ascending: true })
      .range(0, GRANT_HISTORY_PAGE_SIZE - 1)
      .returns<GrantRowQuery[]>(),
    supabase
      .from("financial_periods")
      .select(
        "id, period_start, period_end, total_income, total_expenditure, income_band, filing_date, financial_source",
        { count: "exact" },
      )
      .eq("organisation_id", id)
      .order("period_end", { ascending: false })
      .order("id", { ascending: true })
      .range(0, FINANCIAL_FILINGS_PAGE_SIZE - 1)
      .returns<FinancialFilingRow[]>(),
    // The charts need every award and every filed period, not the first page of
    // each: a grant-share column for FY22 built from "the 20 most recent
    // awards" is a chart of the pagination, not of the client. Two small
    // selects — a charity has at most five filed years, and the widest grant
    // history in the book is under 300 rows.
    Promise.all([
      supabase
        .from("grants")
        // `funder_name` is here for section 5 rather than for the series: the
        // builder only sums awards into the year they fall in, but funder
        // concentration has to group by who gave it, and one list serves both.
        .select("funder_name, amount_awarded, currency, award_date")
        .eq("organisation_id", id)
        .order("award_date", { ascending: false })
        .limit(CHART_GRANT_LIMIT)
        .returns<FunderGrantInput[]>(),
      supabase
        .from("financial_periods")
        .select(
          "period_start, period_end, total_income, total_expenditure, income_band, " +
            "income_donations_legacies, income_charitable_activities, income_other_trading, " +
            "income_investment, income_endowments, income_other, income_govt_grants, " +
            "income_govt_contracts, expenditure_charitable_activities, " +
            "expenditure_raising_funds, expenditure_governance, " +
            "expenditure_grants_institutions, expenditure_investment_management, " +
            "expenditure_other, filing_date, count_employees, count_volunteers, " +
            "receives_govt_grants, receives_govt_contracts, count_govt_grants, " +
            "count_govt_contracts",
        )
        .eq("organisation_id", id)
        .order("period_end", { ascending: false })
        .limit(CHART_PERIOD_LIMIT)
        .returns<FinancialPeriodInput[]>(),
      // The two register facts that make an empty tab explainable, plus the
      // charity number the notice links out with.
      supabase
        .from("organisations")
        .select("registered_on, charity_reporting_status, sector")
        .eq("id", id)
        .maybeSingle<{
          registered_on: string | null;
          charity_reporting_status: string | null;
          sector: string | null;
        }>(),
      supabase
        .from("organisation_identifiers")
        .select("identifier_value")
        .eq("organisation_id", id)
        .eq("identifier_type", "uk_charity")
        .limit(1)
        .maybeSingle<{ identifier_value: string }>(),
      // Declared areas of operation for section 1's reach row. The three
      // loaders are `cache()`-wrapped and shared with the overview tab, so this
      // is the same data that tab already reads rather than a fourth hand-rolled
      // copy of the queries behind it — and `loadSources` in particular goes
      // through an RPC, not a table, which is not a thing to reimplement here.
      Promise.all([loadClient(id), loadIdentifiers(id), loadSources(id)]).then(
        ([client, identifierRows, sourcesResult]) =>
          loadOperatingGeography(client, identifierRows, sourcesResult.sources),
      ),
    ]),
  ]);

  const [chartGrants, chartPeriods, registerFacts, charityIdentifier, geography] =
    chartData;
  if (chartGrants.error) {
    await reportError(chartGrants.error, {
      operation: "clients.detail_financial_chart_grants",
      organisationId: id,
    });
  }
  if (chartPeriods.error) {
    await reportError(chartPeriods.error, {
      operation: "clients.detail_financial_chart_periods",
      organisationId: id,
    });
  }

  if (grants.error) {
    await reportError(grants.error, {
      operation: "clients.detail_grant_history",
      organisationId: id,
    });
  }
  if (filings.error) {
    await reportError(filings.error, {
      operation: "clients.detail_financial_filings",
      organisationId: id,
    });
  }

  const periods = chartPeriods.data ?? [];

  // One series for every mark on this tab, built by the shared builder rather
  // than re-derived per section: the version that lived in the hero card sliced
  // "up to 4 filings" out of a page of 10 and sorted them itself, which quietly
  // meant a charity with five filed years had its oldest dropped from the trend.
  const series = buildFinancialSeries({
    periods,
    grants: chartGrants.data ?? [],
  });

  // Every year that can be drawn as a flow, newest first. A year qualifies only
  // with a split on *both* sides and two sides that square; buildFundFlow
  // returns null rather than a diagram whose widths do not add up, so this is
  // often shorter than the filing history — and empty for every client under
  // the register's £500k reporting threshold. Section 3 says so when it is.
  const flows = buildFundFlows(series);
  const mixYear = [...series.years].reverse().find((year) => year.mix.length > 0);

  const sector = registerFacts.data?.sector ?? null;
  // Derived exactly as the hero card derives the figure it prints — newest
  // filed period, straight off the row — so the strip's percentile and the
  // number above it can never be talking about two different years.
  const latestIncome = periods[0]?.total_income ?? null;
  const distribution = sector
    ? await loadSectorDistribution(supabase, id, sector, latestIncome)
    : null;
  const peerStats = distribution
    ? sectorPeerStatsFromDistribution(distribution, latestIncome)
    : null;

  const missingAccounts = explainMissingAccounts({
    periodCount: periods.length,
    isCharityRegistered: Boolean(charityIdentifier.data?.identifier_value),
    registeredOn: registerFacts.data?.registered_on,
    reportingStatus: registerFacts.data?.charity_reporting_status,
  });

  // The section numbers are fixed, not derived from what this client happens to
  // have. A number is only useful as an address — "look at 3" has to mean the
  // same question on every record — so a section with nothing in it collapses
  // to one line and keeps its number rather than letting 4 become 3.
  //
  // The run is five questions about the client, in the order a CAM asks them:
  // how big, which direction, what the money turns into, who does the work, and
  // how fragile the funding is. What it is *not* is a list of everything on the
  // tab. The two paginated tables underneath are the receipts for those
  // questions rather than questions of their own, so they sit below the run
  // unnumbered — numbering a raw table promises an insight it does not deliver,
  // and the numbers were losing their thread exactly where they got highest.
  const hasFilings = series.years.length > 0;
  // Section 4 needs a filed year that actually published a headcount. The
  // newest return is often a totals-only filing while the one before it carries
  // the counts, so this is "any year", not "the latest year".
  const hasHeadcount = series.years.some(
    (year) => year.employees !== null || year.volunteers !== null,
  );
  const chartGrantRows = chartGrants.data ?? [];
  // Section 5 stands up on either half: awards to group by funder, or a return
  // that says something about public money.
  const hasFundingProfile =
    chartGrantRows.length > 0 ||
    series.years.some(
      (year) =>
        year.governmentIncome !== null ||
        year.receivesGovernmentGrants !== null ||
        year.receivesGovernmentContracts !== null,
    );

  return (
    <Stage>
      <Group className="space-y-4">
        {missingAccounts && (
          <Rise>
            <NoAccountsNotice
              reason={missingAccounts}
              charityNumber={charityIdentifier.data?.identifier_value}
            />
          </Rise>
        )}

        {/* Renders nothing, and no wrapper, when it has nothing to say — it
            carries its own `Rise` for exactly that reason. */}
        <WhyNowStrip grants={chartGrantRows} series={series} />

        <Rise>
          {hasFilings ? (
            <SectionCard
              headingId="fin-scale-heading"
              hint="How big they are — money, people and ground covered — against the clients we hold."
              number={1}
              title="Scale"
            >
              <FinancialsHeroCard
                filings={periods}
                geography={geography}
                organisationId={id}
                peerStats={peerStats}
                sector={sector}
                series={series}
                totalCount={filings.count ?? filings.data?.length ?? 0}
              />
            </SectionCard>
          ) : (
            <SectionUnavailable
              headingId="fin-scale-heading"
              number={1}
              reason="No accounts on record for this organisation yet."
              title="Scale"
            />
          )}
        </Rise>

        <Rise>
          {series.years.length > 1 ? (
            <SectionCard
              headingId="fin-track-heading"
              hint="Income against expenditure across every filed year, and the surplus or deficit that leaves."
              number={2}
              title="Track record"
            >
              <div className="mt-4">
                <FinancialHistoryChart series={series} />
              </div>
            </SectionCard>
          ) : (
            <SectionUnavailable
              headingId="fin-track-heading"
              number={2}
              reason={
                hasFilings
                  ? "Only one filed year on record — a trend needs two."
                  : "No accounts on record for this organisation yet."
              }
              title="Track record"
            />
          )}
        </Rise>

        <Rise>
          {flows.length > 0 || mixYear ? (
            <SectionCard
              headingId="fin-flow-heading"
              hint="Where the money comes from and what it turns into, as filed."
              number={3}
              title="Where the money goes"
            >
              <div className="mt-4">
                {/* The flow answers both halves at once. Where it cannot be
                    drawn honestly — a split on one side only, or two sides that
                    do not square — the income panel still answers half of it. */}
                {flows.length > 0 ? (
                  <FundFlowSankey flows={flows} />
                ) : (
                  mixYear && <IncomeMixPanel year={mixYear} />
                )}
              </div>
            </SectionCard>
          ) : (
            <SectionUnavailable
              headingId="fin-flow-heading"
              number={3}
              reason="Not filed — the register publishes this breakdown only for charities with income over £500,000."
              title="Where the money goes"
            />
          )}
        </Rise>

        <Rise>
          {hasHeadcount ? (
            <SectionCard
              headingId="fin-people-heading"
              hint="Paid staff against volunteers, and what that means for who would run a project."
              number={4}
              title="Who does the work"
            >
              <WhoDoesTheWork series={series} />
            </SectionCard>
          ) : (
            <SectionUnavailable
              headingId="fin-people-heading"
              number={4}
              reason={
                hasFilings
                  ? "Not filed — the register asks for staff and volunteer counts only above its reporting threshold, so an entry-level return leaves them blank."
                  : "No accounts on record for this organisation yet."
              }
              title="Who does the work"
            />
          )}
        </Rise>

        <Rise>
          {hasFundingProfile ? (
            <SectionCard
              headingId="fin-funders-heading"
              hint="How many funders the money comes from, how much rides on the largest, and what share is public money."
              number={5}
              title="Who funds them"
            >
              <FundingProfile grants={chartGrantRows} series={series} />
              <div className="mt-5">
                <YearOnYearGrantsChart grants={chartGrantRows} series={series} />
              </div>
            </SectionCard>
          ) : (
            <SectionUnavailable
              headingId="fin-funders-heading"
              number={5}
              reason="No awards recorded from 360Giving, and no public funding reported on the filed returns."
              title="Who funds them"
            />
          )}
        </Rise>

        {/* The receipts. Unnumbered: these are the rows behind the five
            questions above, not a sixth and seventh question. Dropping the
            `number` prop also reverts the grants card's title from "Funding
            won" back to "Grant history", which is what it is down here. */}
        <Rise>
          <GrantHistorySection
            error={Boolean(grants.error)}
            grants={grants.data ?? []}
            organisationId={id}
            totalCount={grants.count ?? grants.data?.length ?? 0}
          />
        </Rise>

        <Rise>
          <FinancialFilingsSection
            error={Boolean(filings.error)}
            filings={filings.data ?? []}
            organisationId={id}
            totalCount={filings.count ?? filings.data?.length ?? 0}
          />
        </Rise>
      </Group>
    </Stage>
  );
}
