// scripts/test-runner-connection.mts
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("Missing env vars");
}

const supabase = createClient(url, key);

const { data, error } = await supabase
  .from("ingestion_runs")
  .select("*")
  .limit(1);

console.log("Error:", error);
console.log("Data:", data);
