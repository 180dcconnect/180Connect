/**
 * Populates a development or staging database with fake organisations (F233).
 *
 *     npm run seed
 *
 * The records are invented, never real or anonymised client data — see
 * `src/lib/seed/fixtures.ts`. Safety checks live in `src/lib/seed/config.ts`.
 *
 * Two properties this script must hold, and how it holds them:
 *
 *   Idempotent (AC5). Every run deletes the rows it previously created — matched by
 *   `is_seed = true`, never by name or by a row count — and then inserts a fresh
 *   set. Running it ten times leaves the same 50 rows as running it once.
 *
 *   All-or-nothing (AC5). The delete and the inserts share one transaction. A
 *   failure part-way through rolls back to the state before the run, so the
 *   database is never left holding half a seed.
 *
 * `pg` is used rather than supabase-js because supabase-js speaks PostgREST, which
 * has no multi-statement transaction. Connecting as Postgres also means RLS is not
 * in the way, which is what makes the bulk delete possible.
 */

import { Client } from "pg";
import { reportError } from "../src/lib/error-logging.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";
import {
  DEFAULT_ORGANISATION_COUNT,
  OUTREACH_STATUSES,
  generateOrganisations,
  type SeedOrganisation,
} from "../src/lib/seed/fixtures.ts";
import { computePriorityScore } from "../src/lib/scoring/score-client.ts";

/** Columns written by the seed, in the order the insert binds them. */
const COLUMNS = [
  "legal_name",
  "trading_name",
  "country_code",
  "is_international",
  "entry_method",
  "is_verified",
  "organisation_type",
  "website",
  "contact_email",
  "address_line_1",
  "city",
  "postcode",
  "geographic_reach",
  "outreach_status",
  "data_completeness_score",
  "is_seed",
] as const satisfies readonly (keyof SeedOrganisation)[];

/** Postgres error code for "relation does not exist". */
const UNDEFINED_TABLE = "42P01";

/** Builds the multi-row INSERT and its bound values. */
function buildInsert(organisations: readonly SeedOrganisation[]): {
  text: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const rows = organisations.map((organisation) => {
    const placeholders = COLUMNS.map((column) => {
      values.push(organisation[column]);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  return {
    text:
      `insert into public.organisations (${COLUMNS.join(", ")})\n` +
      `values ${rows.join(",\n       ")}`,
    values,
  };
}

/** One line per pipeline stage, plus the completeness split, for the run summary. */
function summarise(organisations: readonly SeedOrganisation[]): string {
  const complete = organisations.filter(
    (organisation) => organisation.data_completeness_score === 1,
  ).length;
  const byStatus = OUTREACH_STATUSES.map((status) => {
    const count = organisations.filter(
      (organisation) => organisation.outreach_status === status,
    ).length;
    return `    ${status.padEnd(12)} ${count}`;
  });

  return [
    ...byStatus,
    "",
    `    complete profiles    ${complete}`,
    `    incomplete profiles  ${organisations.length - complete}`,
  ].join("\n");
}

async function main(): Promise<void> {
  // Throws SeedRefusedError against production, SeedConfigError when unconfigured.
  const config = resolveSeedConfig(process.env);
  const organisations = generateOrganisations(DEFAULT_ORGANISATION_COUNT);

  console.log(`[seed] target: ${config.target}`);

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    await client.query("begin");

    const { rowCount: removed } = await client.query(
      "delete from public.organisations where is_seed",
    );
    const insert = buildInsert(organisations);
    await client.query(insert.text, insert.values);

    // F058/F059 — seeded clients get LATEST_SCORES rows in the same transaction,
    // so staging demos exercise the score filter, sort and pills instead of
    // showing an all-dash column. Same pure engine the rescore hooks use.
    //
    // Seeded orgs also get one filed financial period each, cycling through the
    // four canonical income bands: without it every size factor sits at its
    // neutral default, all fifty clients band "medium", and neither the F058
    // filter nor the F059 sort has anything interesting to show in a demo.
    const { rows: seededOrgs } = await client.query<{
      id: string;
      city: string | null;
      outreach_status: string;
    }>(
      "select id, city, outreach_status from public.organisations where is_seed order by created_at",
    );
    if (seededOrgs.length > 0) {
      // One demo income per band, cycled deterministically across the rows.
      const DEMO_INCOMES = [8_000, 45_000, 500_000, 2_000_000];
      const DEMO_BANDS = ["under_10k", "10k_100k", "100k_1m", "over_1m"] as const;
      const fpValues: unknown[] = [];
      const fpPlaceholders = seededOrgs.map((row, index) => {
        const slot = index % DEMO_INCOMES.length;
        fpValues.push(
          row.id,
          "2024-04-01",
          "2025-03-31",
          DEMO_INCOMES[slot],
          DEMO_BANDS[slot],
          "charity_commission",
        );
        const base = fpValues.length - 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      });
      await client.query(
        `
        insert into public.financial_periods
          (organisation_id, period_start, period_end, total_income, income_band, financial_source)
        values ${fpPlaceholders.join(",\n       ")}
        `,
        fpValues,
      );

      const { rows: scoredOrgs } = await client.query<{
        id: string;
        city: string | null;
        outreach_status: string;
        total_income: string | null;
      }>(
        `
        select
          o.id,
          o.city,
          o.outreach_status,
          (
            select fp.total_income::text
            from public.financial_periods fp
            where fp.organisation_id = o.id
            order by fp.period_end desc nulls last
            limit 1
          ) as total_income
        from public.organisations o
        where o.is_seed
        `,
      );
      const scoreValues: unknown[] = [];
      const scorePlaceholders = scoredOrgs.map((row) => {
        const { score, band } = computePriorityScore({
          city: row.city,
          outreach_status: row.outreach_status,
          total_income: row.total_income === null ? null : Number(row.total_income),
        });
        scoreValues.push(row.id, score, band);
        return `($${scoreValues.length - 2}, $${scoreValues.length - 1}, $${scoreValues.length}, 'rule_engine', now())`;
      });
      await client.query(
        `
        insert into public.latest_scores
          (organisation_id, priority_score, priority_band, score_source, scored_at)
        values ${scorePlaceholders.join(",\n       ")}
        on conflict (organisation_id) do nothing
        `,
        scoreValues,
      );
    }

    await client.query("commit");

    console.log(`[seed] removed ${removed ?? 0} existing seed rows`);
    console.log(`[seed] inserted ${organisations.length} organisations`);
    console.log(`[seed] scored ${seededOrgs.length} organisations into latest_scores`);
    console.log(summarise(organisations));
    console.log(
      "\n[seed] every row has is_seed = true — " +
        "delete them with: delete from public.organisations where is_seed;",
    );
  } catch (error) {
    // Roll back before rethrowing, so a mid-run failure leaves no partial state.
    // A failing rollback must not mask the error that caused it.
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(async (error: unknown) => {
  // A production refusal is a guard doing its job, not a defect: print it and
  // stop, without logging noise every time someone points at the wrong database.
  if (error instanceof SeedRefusedError) {
    console.error(`\n[seed] ${error.message}\n`);
    process.exit(1);
  }

  // A missing or misconfigured DB env fails loud AND is recorded per ERROR_LOG
  // (F233 AC6). reportError always writes a structured console line and only
  // ships to Sentry when a DSN is set, so this is durable without being noisy.
  if (error instanceof SeedConfigError) {
    console.error(`\n[seed] ${error.message}\n`);
    await reportError(error, { script: "seed", env: DB_URL_VAR });
    process.exit(1);
  }

  const isMissingTable =
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === UNDEFINED_TABLE;

  if (isMissingTable) {
    console.error(
      "\n[seed] public.organisations does not exist in the target database.\n" +
        "  Apply the migrations first — see supabase/MIGRATIONS.md:\n" +
        "    supabase db push        # against a linked project\n" +
        "    supabase migration up   # against the local stack\n",
    );
  } else {
    console.error(
      "\n[seed] failed — no rows were written. Any open transaction was rolled back.",
    );
    console.error(error);
  }

  await reportError(error, { script: "seed", env: DB_URL_VAR });
  process.exit(1);
});
