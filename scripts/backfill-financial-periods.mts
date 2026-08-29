/**
 * Backfills public.financial_periods for organisations whose Charity Commission
 * raw record carries a filed financial year.
 *
 *     npm run backfill:financial-periods
 *
 * The financial-period write path (write-organisations.ts's
 * upsertFinancialPeriod) only covers organisations promoted after it landed —
 * and even then only when the raw payload carries figures (detail responses
 * do; most bulk-search responses don't). Everything promoted before it has no
 * FINANCIAL_PERIODS row, so the SCOUT income factors (income_band, income_trend,
 * financial_stability) and the client list's income column have nothing to read
 * — this closes that gap for history, exactly like backfill-priority-scores and
 * backfill-identifiers do for theirs.
 *
 * Reads the source of truth: validated charity_commission raw records linked to
 * an organisation via matched_organisation_id (see write-organisations.ts's
 * processing_status semantics), taking the latest received per organisation so
 * a re-ingested charity doesn't produce two rows for the same org. The payload
 * fields are the Charity Commission API's latest financial year:
 *   - latest_income / latest_expenditure
 *   - latest_acc_fin_year_start_date / latest_acc_fin_year_end_date
 *
 * Idempotent: the (organisation_id, period_start, period_end, financial_source)
 * unique index means a re-run (or a row already written by the new promote
 * path) is ignored, never duplicated. income_band is computed from total_income
 * via the same deriveIncomeBand the promote path uses.
 *
 * Uses pg directly for the same reasons the seeder and the other backfills do:
 * one transaction, RLS not in the way, no PostgREST row-count ceiling. Reuses
 * the seed config guard so pointing it at production refuses loudly.
 */

import { Client } from "pg";
import { reportError } from "../src/lib/error-logging.ts";
import { deriveIncomeBand, type IncomeBand } from "../src/lib/income-band.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";

type FinancialCandidate = {
  organisation_id: string;
  latest_income: string | null;
  latest_expenditure: string | null;
  fin_start: string | null;
  fin_end: string | null;
};

type FinancialRow = {
  organisation_id: string;
  period_start: string;
  period_end: string;
  total_income: number | null;
  total_expenditure: number | null;
  income_band: IncomeBand | null;
};

const BATCH_SIZE = 200;

/** A payload figure (string in the JSON, even when numeric) as a number. */
function toNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** ISO datetime (\"2024-04-01T00:00:00\") → plain date, or null when malformed. */
function toDate(value: string | null): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

async function main(): Promise<void> {
  // Throws SeedRefusedError against production, SeedConfigError when unconfigured
  // — deliberately the same guard the seeder uses, since this writes just as broad.
  const config = resolveSeedConfig(process.env);

  console.log(`[backfill:financial-periods] target: ${config.target}`);

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    await client.query("begin");

    // The candidates: the latest validated charity_commission record per
    // organisation, so a re-ingested charity doesn't produce two rows for the
    // same org. #>> (not ->) returns values as unquoted text whether the
    // payload stores them as JSON numbers or JSON strings.
    const { rows: candidates } = await client.query<FinancialCandidate>(`
      with latest as (
        select
          matched_organisation_id as organisation_id,
          raw_payload #>> '{latest_income}' as latest_income,
          raw_payload #>> '{latest_expenditure}' as latest_expenditure,
          raw_payload #>> '{latest_acc_fin_year_start_date}' as fin_start,
          raw_payload #>> '{latest_acc_fin_year_end_date}' as fin_end,
          row_number() over (
            partition by matched_organisation_id
            order by received_at desc
          ) as rn
        from public.raw_source_records
        where record_source = 'charity_commission'
          and processing_status = 'validated'
          and matched_organisation_id is not null
      )
      select organisation_id, latest_income, latest_expenditure, fin_start, fin_end
      from latest
      where rn = 1
    `);

    // Same no-filing rules as the promote path: needs both period dates and at
    // least one figure. A filing with only one figure is still a filing — the
    // missing half stays null.
    const rows: FinancialRow[] = [];
    for (const candidate of candidates) {
      const periodStart = toDate(candidate.fin_start);
      const periodEnd = toDate(candidate.fin_end);
      const totalIncome = toNumber(candidate.latest_income);
      const totalExpenditure = toNumber(candidate.latest_expenditure);
      if (!periodStart || !periodEnd) continue;
      if (totalIncome === null && totalExpenditure === null) continue;
      rows.push({
        organisation_id: candidate.organisation_id,
        period_start: periodStart,
        period_end: periodEnd,
        total_income: totalIncome,
        total_expenditure: totalExpenditure,
        income_band: deriveIncomeBand(totalIncome),
      });
    }

    if (rows.length === 0) {
      await client.query("commit");
      console.log("[backfill:financial-periods] no filings to write — nothing to do.");
      return;
    }

    let writtenCount = 0;
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((row) => {
        values.push(
          row.organisation_id,
          row.period_start,
          row.period_end,
          row.total_income,
          row.total_expenditure,
          row.income_band,
        );
        const n = values.length;
        return `($${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n}, 'charity_commission', now())`;
      });

      // RETURNING makes the inserted count exact: an ON CONFLICT DO NOTHING
      // skip is not a row in the result, so writtenCount is precisely what
      // landed, and rows.length - writtenCount is the already-present tally.
      const { rows: inserted } = await client.query(
        `
        insert into public.financial_periods
          (organisation_id, period_start, period_end, total_income,
           total_expenditure, income_band, financial_source, created_at)
        values ${placeholders.join(",\n       ")}
        on conflict (organisation_id, period_start, period_end, financial_source)
        do nothing
        returning id
        `,
        values,
      );
      writtenCount += inserted.length;
    }

    await client.query("commit");

    const skippedCount = rows.length - writtenCount;
    console.log(
      `[backfill:financial-periods] wrote ${writtenCount} filing(s), ` +
        `${skippedCount} already present.`,
    );
    console.log(
      "    Charity Commission latest income/expenditure now feed the SCOUT income\n" +
        "    factors and the client list's income column.",
    );
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(async (error: unknown) => {
  if (error instanceof SeedRefusedError) {
    console.error(`\n[backfill:financial-periods] ${error.message}\n`);
    process.exit(1);
  }
  if (error instanceof SeedConfigError) {
    console.error(`\n[backfill:financial-periods] ${error.message}\n`);
    await reportError(error, { script: "backfill-financial-periods", env: DB_URL_VAR });
    process.exit(1);
  }
  console.error("\n[backfill:financial-periods] failed — no rows were written.");
  console.error(error);
  await reportError(error, { script: "backfill-financial-periods", env: DB_URL_VAR });
  process.exit(1);
});
