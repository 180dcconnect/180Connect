/**
 * Backfills public.organisation_identifiers for organisations already promoted
 * by the F041/F260 standardize layer.
 *
 *     npm run backfill:identifiers
 *
 * The identifier write path (write-organisations.ts's upsertIdentifier) only
 * covers organisations promoted after it landed. Everything promoted before it
 * has no uk_charity/uk_company row, so the 360Giving bulk walk (F035) has
 * nothing to ask about — this closes that gap for history, exactly like
 * backfill-priority-scores does for scores.
 *
 * Reads the source of truth for what an organisation *is*: raw_source_records
 * rows with processing_status = 'validated' (the record that originally
 * created the org, linked by matched_organisation_id — see
 * write-organisations.ts's processing_status semantics):
 *   - companies_house:    uk_company  = source_record_id (the normalised
 *                                        company number)
 *   - charity_commission: uk_charity  = raw_payload->>reg_charity_number
 *     (NOT source_record_id, which is the organisation_number)
 *
 * Idempotent: an identifier value already present (written by the new promote
 * path, or by this script on a previous run) is skipped. The first identifier
 * an organisation receives is marked is_primary, matching upsertIdentifier's
 * semantics.
 *
 * Uses pg directly for the same reasons the seeder and backfill-priority-scores
 * do: one transaction, RLS not in the way, no PostgREST row-count ceiling.
 * Reuses the seed config guard so pointing it at production refuses loudly.
 */

import { Client } from "pg";
import { reportError } from "../src/lib/error-logging.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";

type IdentifierCandidate = {
  organisation_id: string;
  identifier_type: "uk_charity" | "uk_company";
  identifier_value: string;
};

const BATCH_SIZE = 200;

async function main(): Promise<void> {
  // Throws SeedRefusedError against production, SeedConfigError when unconfigured
  // — deliberately the same guard the seeder uses, since this writes just as broad.
  const config = resolveSeedConfig(process.env);

  console.log(`[backfill:identifiers] target: ${config.target}`);

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    await client.query("begin");

    // What already exists — both to skip (an org with any identifier needs no
    // primary promotion) and to avoid re-inserting a value already taken.
    const existing = await client.query<{
      organisation_id: string;
      identifier_type: string;
      identifier_value: string;
    }>(`
      select organisation_id, identifier_type, identifier_value
      from public.organisation_identifiers
    `);
    const takenValues = new Set(
      existing.rows.map((row) => `${row.identifier_type}|${row.identifier_value}`),
    );
    const orgsWithAnyIdentifier = new Set(existing.rows.map((row) => row.organisation_id));

    // The candidates: the latest validated raw record per (organisation, source),
    // so a re-ingested company doesn't produce two rows for the same org.
    const { rows: candidates } = await client.query<IdentifierCandidate>(`
      with latest as (
        select
          matched_organisation_id as organisation_id,
          record_source,
          source_record_id,
          -- #>> (not ->) returns the value as unquoted text whether the payload
          -- stores it as a JSON number or a JSON string.
          raw_payload #>> '{reg_charity_number}' as reg_charity_number,
          row_number() over (
            partition by matched_organisation_id, record_source
            order by received_at desc
          ) as rn
        from public.raw_source_records
        where processing_status = 'validated'
          and matched_organisation_id is not null
      )
      select organisation_id, identifier_type, identifier_value
      from (
        select
          organisation_id,
          'uk_company'::text as identifier_type,
          source_record_id as identifier_value,
          rn
        from latest
        where record_source = 'companies_house'
          and source_record_id is not null
          and trim(source_record_id) <> ''
        union all
        select
          organisation_id,
          'uk_charity'::text as identifier_type,
          reg_charity_number as identifier_value,
          rn
        from latest
        where record_source = 'charity_commission'
          and reg_charity_number is not null
          and trim(reg_charity_number) <> ''
      ) combined
      where rn = 1
    `);

    const rows: IdentifierCandidate[] = [];
    for (const candidate of candidates) {
      const key = `${candidate.identifier_type}|${candidate.identifier_value}`;
      if (takenValues.has(key)) continue;
      takenValues.add(key);
      rows.push(candidate);
    }

    if (rows.length === 0) {
      await client.query("commit");
      console.log("[backfill:identifiers] no identifiers to write — nothing to do.");
      return;
    }

    // is_primary: the first identifier an organisation receives is its primary
    // one (partial unique index — one primary per organisation). Computed here
    // so the batch insert stays one statement; orgs processed earlier in the
    // loop are visible to later candidates for the same org.
    let writtenCount = 0;
    let primaryCount = 0;
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((row) => {
        const isPrimary = !orgsWithAnyIdentifier.has(row.organisation_id);
        if (isPrimary) orgsWithAnyIdentifier.add(row.organisation_id);
        writtenCount += 1;
        if (isPrimary) primaryCount += 1;
        values.push(
          row.organisation_id,
          row.identifier_type,
          row.identifier_value,
          isPrimary,
        );
        const n = values.length;
        return `($${n - 3}, $${n - 2}, $${n - 1}, 'GB', $${n}, false, now())`;
      });

      // Plain insert, no ON CONFLICT: (identifier_type, identifier_value) is a
      // lookup index, not a unique constraint (the Data Model allows the same
      // registry number under two organisations), and the takenValues dedup
      // above already guards re-inserts within this transaction.
      await client.query(
        `
        insert into public.organisation_identifiers
          (organisation_id, identifier_type, identifier_value, registry_country,
           is_primary, verified, created_at)
        values ${placeholders.join(",\n       ")}
        `,
        values,
      );
    }

    await client.query("commit");

    console.log(`[backfill:identifiers] wrote ${writtenCount} identifiers (${primaryCount} primary)`);
    console.log(
      "    uk_company (Companies House) and uk_charity (Charity Commission) — the 360Giving\n" +
        "    bulk walk now has registry numbers to ask about.",
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
    console.error(`\n[backfill:identifiers] ${error.message}\n`);
    process.exit(1);
  }
  if (error instanceof SeedConfigError) {
    console.error(`\n[backfill:identifiers] ${error.message}\n`);
    await reportError(error, { script: "backfill-identifiers", env: DB_URL_VAR });
    process.exit(1);
  }
  console.error("\n[backfill:identifiers] failed — no rows were written.");
  console.error(error);
  await reportError(error, { script: "backfill-identifiers", env: DB_URL_VAR });
  process.exit(1);
});
