/**
 * Fill a missing client location from a postcode already on the record.
 *
 *   npm run backfill:locations -- --dry-run  # show what can be filled
 *   npm run backfill:locations               # apply those locations
 *
 * The location comes from the same postcodes.io resolver used by the admin
 * incomplete-records screen. Only GB records with a blank city and a valid
 * postcode are candidates. A postcode must resolve to exactly one council area;
 * ambiguous outward codes are left for an admin to choose on screen.
 *
 * The write is idempotent and race-safe: the UPDATE repeats the blank-city
 * condition, so a location entered by a person while the lookups are running is
 * never overwritten. The production refusal is the same guard used by the other
 * broad backfills in this repository.
 */

import { Client } from "pg";
import { reportError } from "../src/lib/error-logging.ts";
import { containsRedactionPlaceholder } from "../src/lib/ingestion/personal-data.ts";
import {
  createDefaultPostcodeLookupDependencies,
  looksLikePostcode,
  lookupPostcodePlaces,
} from "../src/lib/postcode-lookup.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";

type Candidate = {
  id: string;
  postcode: string;
};

type Patch = Candidate & {
  city: string;
};

const dryRun = process.argv.includes("--dry-run");
const LOOKUP_BATCH_SIZE = 8;
const WRITE_BATCH_SIZE = 200;

function compactPostcode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

async function main(): Promise<void> {
  const config = resolveSeedConfig(process.env);
  console.log(`[backfill:locations] target: ${config.target}`);

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    const { rows } = await client.query<Candidate>(`
      select id, postcode
      from public.organisations
      where nullif(btrim(city), '') is null
        and nullif(btrim(postcode), '') is not null
        and upper(btrim(country_code)) = 'GB'
      order by id
    `);

    if (rows.length === 0) {
      console.log("[backfill:locations] no clients have a postcode and a missing location.");
      return;
    }

    const candidates = rows.filter(
      (row) =>
        looksLikePostcode(row.postcode) &&
        !containsRedactionPlaceholder(row.postcode),
    );
    const invalidCount = rows.length - candidates.length;
    const postcodes = [...new Set(candidates.map((row) => compactPostcode(row.postcode)))];
    const cityByPostcode = new Map<string, string>();
    let ambiguousCount = 0;
    let notFoundCount = 0;
    let unavailableCount = 0;

    const dependencies = createDefaultPostcodeLookupDependencies();
    for (let offset = 0; offset < postcodes.length; offset += LOOKUP_BATCH_SIZE) {
      const batch = postcodes.slice(offset, offset + LOOKUP_BATCH_SIZE);
      await Promise.all(
        batch.map(async (postcode) => {
          const result = await lookupPostcodePlaces(postcode, dependencies);
          if (result.status === "unavailable") {
            unavailableCount += 1;
            return;
          }
          if (result.status !== "found") {
            notFoundCount += 1;
            return;
          }
          if (result.districts.length !== 1) {
            ambiguousCount += 1;
            return;
          }
          cityByPostcode.set(postcode, result.districts[0].trim());
        }),
      );
    }

    const patches: Patch[] = candidates.flatMap((row) => {
      const city = cityByPostcode.get(compactPostcode(row.postcode));
      return city ? [{ ...row, city }] : [];
    });

    console.log(`[backfill:locations] clients checked: ${rows.length}`);
    console.log(`  ready to fill:       ${patches.length}`);
    console.log(`  invalid postcodes:   ${invalidCount}`);
    console.log(`  ambiguous postcodes: ${ambiguousCount}`);
    console.log(`  not found:           ${notFoundCount}`);
    console.log(`  service unavailable: ${unavailableCount}`);

    if (dryRun) {
      console.log("[backfill:locations] dry run — nothing was written.");
      return;
    }

    if (patches.length === 0) {
      console.log("[backfill:locations] nothing could be filled automatically.");
      return;
    }

    await client.query("begin");
    let writtenCount = 0;

    for (let offset = 0; offset < patches.length; offset += WRITE_BATCH_SIZE) {
      const batch = patches.slice(offset, offset + WRITE_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((patch) => {
        values.push(patch.id, patch.city);
        const n = values.length;
        return `($${n - 1}::uuid, $${n}::text)`;
      });

      const result = await client.query<{ id: string }>(
        `
        update public.organisations as organisation
        set
          city = patch.city,
          data_completeness_score = round((
            (case when nullif(btrim(organisation.legal_name), '') is null then 0 else 1 end) +
            (case when nullif(btrim(organisation.trading_name), '') is null then 0 else 1 end) +
            (case when nullif(btrim(organisation.website), '') is null then 0 else 1 end) +
            (case when nullif(btrim(organisation.contact_email), '') is null then 0 else 1 end) +
            (case when nullif(btrim(organisation.address_line_1), '') is null then 0 else 1 end) +
            1 +
            (case when nullif(btrim(organisation.postcode), '') is null then 0 else 1 end) +
            (case when organisation.geographic_reach is null then 0 else 1 end)
          )::numeric / 8, 2)
        from (values ${placeholders.join(",\n          ")}) as patch(id, city)
        where organisation.id = patch.id
          and nullif(btrim(organisation.city), '') is null
        returning organisation.id
        `,
        values,
      );
      writtenCount += result.rowCount ?? 0;
    }

    await client.query(
      `
      insert into public.audit_log
        (actor_user_id, action, target_table, target_id, detail)
      values
        (null, 'locations_backfilled_from_postcodes', 'organisations', null, $1::jsonb)
      `,
      [
        JSON.stringify({
          organisations_updated: writtenCount,
          unique_postcodes_resolved: cityByPostcode.size,
          source: "postcodes.io",
        }),
      ],
    );

    await client.query("commit");
    console.log(`[backfill:locations] filled ${writtenCount} client locations.`);
    console.log(
      "[backfill:locations] run `npm run backfill:scores` so location-based priority scores match.",
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
    console.error(`\n[backfill:locations] ${error.message}\n`);
    process.exit(1);
  }
  if (error instanceof SeedConfigError) {
    console.error(`\n[backfill:locations] ${error.message}\n`);
    await reportError(error, { script: "backfill-locations", env: DB_URL_VAR });
    process.exit(1);
  }
  console.error("\n[backfill:locations] failed — no partial batch was committed.");
  console.error(error);
  await reportError(error, { script: "backfill-locations", env: DB_URL_VAR });
  process.exit(1);
});
