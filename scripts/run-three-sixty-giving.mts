// Real end-to-end check: runs the full ingestion pipeline (fetch + write) for
// 360Giving against the real Supabase database.
//
//   npm run ingest:run-three-sixty-giving
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
// (no API key for 360Giving itself — api.threesixtygiving.org needs none).
// Writes real rows to raw_source_records and ingestion_runs — this is not a
// dry run. Walks every uk_charity/uk_company identifier already in the
// database, so this is slow — see threesixtygiving.ts's REQUEST_INTERVAL_MS.
import { createThreeSixtyGivingAdapter } from "../src/lib/ingestion/sources/threesixtygiving.ts";
import { runIngestion } from "../src/lib/ingestion/runner.ts";

const [summary] = await runIngestion([createThreeSixtyGivingAdapter()]);
console.log(summary);
