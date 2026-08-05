// Runs a real Companies House ingestion against whatever SUPABASE_SERVICE_ROLE_KEY
// points at. Writes to the database.
//
//   npm run ingest:companies-house -- 00000006
//
// Run it twice: the second run should report skipped == fetched, because every
// checksum matches.

import { runIngestion } from "../src/lib/ingestion/runner.ts";
import { createCompaniesHouseAdapter } from "../src/lib/ingestion/sources/companieshouse.ts";

const companyNumber = process.argv[2];
if (!companyNumber) {
  throw new Error("Pass a company number: npm run ingest:companies-house -- 00000006");
}

console.table(
  await runIngestion(
    [createCompaniesHouseAdapter({ companyNumber })],
    { triggeredBy: "manual" },
  ),
);
