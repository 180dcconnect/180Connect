// Real end-to-end check: matches pending 360giving raw_source_records against
// already-known charities/companies and writes GRANTS rows, against whatever
// database NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY point to in
// .env.local.
//
//   npm run standardize:run-three-sixty-giving
//
// Writes real rows to grants and updates raw_source_records' processing_status
// — this is not a dry run. Confirm .env.local points at your LOCAL Supabase
// (http://127.0.0.1:54321), not a shared environment, before running this.
import { promotePendingThreeSixtyGivingRecords } from "../src/lib/standardize/three-sixty-giving.ts";

const counts = await promotePendingThreeSixtyGivingRecords();
console.log(counts);
