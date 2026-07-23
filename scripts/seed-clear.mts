/**
 * Removes all seed data from a development or staging database (F233).
 *
 *     npm run seed:clear
 *
 * Deletes every row marked `is_seed = true` and leaves real data untouched. Uses
 * the same target resolution and production guards as `npm run seed`, so it can
 * no more run against production than the seed itself can.
 *
 * This is the same delete the seed script runs before re-inserting; it exists as
 * its own command for when you want the fake data *gone* — before a demo of real
 * data, or when handing a database over.
 */

import { Client } from "pg";
import { reportError } from "../src/lib/error-logging.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";

const UNDEFINED_TABLE = "42P01";

async function main(): Promise<void> {
  const config = resolveSeedConfig(process.env);
  console.log(`[seed:clear] target: ${config.target}`);

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    const { rowCount } = await client.query(
      "delete from public.organisations where is_seed",
    );
    console.log(`[seed:clear] removed ${rowCount ?? 0} seed rows`);
  } finally {
    await client.end();
  }
}

main().catch(async (error: unknown) => {
  if (error instanceof SeedRefusedError) {
    console.error(`\n[seed:clear] ${error.message}\n`);
    process.exit(1);
  }

  // Missing/misconfigured env: loud AND recorded per ERROR_LOG (F233 AC6).
  if (error instanceof SeedConfigError) {
    console.error(`\n[seed:clear] ${error.message}\n`);
    await reportError(error, { script: "seed-clear", env: DB_URL_VAR });
    process.exit(1);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === UNDEFINED_TABLE
  ) {
    console.error(
      "\n[seed:clear] public.organisations does not exist — nothing to clear.\n",
    );
    process.exit(1);
  }

  console.error("\n[seed:clear] failed.");
  console.error(error);
  await reportError(error, { script: "seed-clear", env: DB_URL_VAR });
  process.exit(1);
});
