// Real end-to-end check: runs the full ingestion pipeline (fetch + write) for
// Charity Commission against the real Supabase database.
//
//   npm run ingest:run-charity-commission
//
// Needs CHARITY_COMMISSION_API_KEY, NEXT_PUBLIC_SUPABASE_URL, and
// SUPABASE_SERVICE_ROLE_KEY in .env.local. Writes real rows to
// raw_source_records and ingestion_runs — this is not a dry run.
import { charityCommissionAdapter } from "../src/lib/ingestion/sources/charity-commission.ts";
import { runIngestion } from "../src/lib/ingestion/runner.ts";

const [summary] = await runIngestion([charityCommissionAdapter]);
console.log(summary);
