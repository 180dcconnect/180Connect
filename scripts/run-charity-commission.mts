// Real end-to-end check: runs the full ingestion pipeline (fetch + write) for
// Charity Commission discovery against the real Supabase database.
//
//   npm run ingest:run-charity-commission
//
// Discovery searches forward from the last registration date already ingested,
// so it finds charities registered since the previous run and nothing else. For
// established charities — the ones with filed accounts — use
// `npm run ingest:charity-commission-bulk` instead.
//
// Needs CHARITY_COMMISSION_API_KEY, NEXT_PUBLIC_SUPABASE_URL, and
// SUPABASE_SERVICE_ROLE_KEY in .env.local. Writes real rows to
// raw_source_records and ingestion_runs — this is not a dry run.
import { createCharityCommissionDiscoveryAdapter } from "../src/lib/ingestion/sources/charity-commission.ts";
import { runIngestion } from "../src/lib/ingestion/runner.ts";

const [summary] = await runIngestion([createCharityCommissionDiscoveryAdapter()]);
console.log(summary);
