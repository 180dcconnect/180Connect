// Connectivity check: can the service-role client reach ingestion_runs at all?
// Useful for telling "my key/URL is wrong" apart from "the ingestion logic is wrong".
//
//   npm run ingest:check-connection

import { buildAdminClient } from "../src/lib/supabase/admin-client-factory.ts";

const supabase = buildAdminClient();
if (!supabase) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const { data, error } = await supabase
  .from("ingestion_runs")
  .select("*")
  .limit(1);

console.log("Error:", error);
console.log("Data:", data);
