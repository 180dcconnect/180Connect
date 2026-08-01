// Runs a real Companies House ingestion against whatever SUPABASE_SERVICE_ROLE_KEY
// points at. Writes to the database.
//
//   npm run ingest:companies-house
//
// Run it twice: the second run should report skipped == fetched, because every
// checksum matches.

import { runIngestion } from "../src/lib/ingestion/runner.ts";
import { companiesHouseAdapter } from "../src/lib/ingestion/sources/companieshouse.ts";

await runIngestion([companiesHouseAdapter], { triggeredBy: "manual" });
