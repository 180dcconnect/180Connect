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
import { requireActor } from "../load-record";
import {
  explainMissingAccounts,
  type FinancialPeriodInput,
  type GrantInput,
} from "@/lib/financials/financial-series";
import { NoAccountsNotice } from "./no-accounts-notice";

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
        .select("amount_awarded, currency, award_date")
        .eq("organisation_id", id)
        .order("award_date", { ascending: false })
        .limit(CHART_GRANT_LIMIT)
        .returns<GrantInput[]>(),
      supabase
        .from("financial_periods")
        .select(
          "period_start, period_end, total_income, total_expenditure, income_band, " +
            "income_donations_legacies, income_charitable_activities, income_other_trading, " +
            "income_investment, income_endowments, income_other, income_govt_grants, " +
            "income_govt_contracts",
        )
        .eq("organisation_id", id)
        .order("period_end", { ascending: false })
        .limit(CHART_PERIOD_LIMIT)
        .returns<FinancialPeriodInput[]>(),
      // The two register facts that make an empty tab explainable, plus the
      // charity number the notice links out with.
      supabase
        .from("organisations")
        .select("registered_on, charity_reporting_status")
        .eq("id", id)
        .maybeSingle<{
          registered_on: string | null;
          charity_reporting_status: string | null;
        }>(),
      supabase
        .from("organisation_identifiers")
        .select("identifier_value")
        .eq("organisation_id", id)
        .eq("identifier_type", "uk_charity")
        .limit(1)
        .maybeSingle<{ identifier_value: string }>(),
    ]),
  ]);

  const [chartGrants, chartPeriods, registerFacts, charityIdentifier] = chartData;
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
  const missingAccounts = explainMissingAccounts({
    periodCount: periods.length,
    isCharityRegistered: Boolean(charityIdentifier.data?.identifier_value),
    registeredOn: registerFacts.data?.registered_on,
    reportingStatus: registerFacts.data?.charity_reporting_status,
  });

  return (
    <Stage>
      <Group className="space-y-6">
        {missingAccounts && (
          <Rise>
            <NoAccountsNotice
              reason={missingAccounts}
              charityNumber={charityIdentifier.data?.identifier_value}
            />
          </Rise>
        )}

        <Rise>
          <FinancialsHeroCard
            filings={periods.length > 0 ? periods : (filings.data ?? [])}
            totalCount={filings.count ?? filings.data?.length ?? 0}
            grants={chartGrants.data ?? []}
          />
        </Rise>

        <Rise>
          <GrantHistorySection
            organisationId={id}
            grants={grants.data ?? []}
            totalCount={grants.count ?? grants.data?.length ?? 0}
            error={Boolean(grants.error)}
          />
        </Rise>

        <Rise>
          <FinancialFilingsSection
            organisationId={id}
            filings={filings.data ?? []}
            totalCount={filings.count ?? filings.data?.length ?? 0}
            error={Boolean(filings.error)}
          />
        </Rise>
      </Group>
    </Stage>
  );
}
