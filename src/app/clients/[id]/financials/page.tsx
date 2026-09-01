import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Group, Rise, Stage } from "@/components/dashboard-stage";

import { FinancialFilingsSection } from "../financial-filings-section";
import {
  FINANCIAL_FILINGS_PAGE_SIZE,
  type FinancialFilingRow,
} from "../financial-filing-item";
import { GrantHistorySection } from "../grant-history-section";
import { GRANT_HISTORY_PAGE_SIZE, type GrantRow } from "../grant-list-item";
import { requireActor } from "../load-record";

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

  const [grants, filings] = await Promise.all([
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
  ]);

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

  return (
    <Stage>
      <Group className="space-y-6">
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
