// Real end-to-end check: promotes pending charity_commission raw_source_records
// into organisations, against whatever database NEXT_PUBLIC_SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY point to in .env.local.
//
//   npm run standardize:run-charity-commission
//
// Writes real rows to organisations and updates raw_source_records'
// processing_status — this is not a dry run. Confirm .env.local points at
// your LOCAL Supabase (http://127.0.0.1:54321), not a shared environment,
// before running this.
import { promotePendingCharityCommissionRecords } from "../src/lib/standardize/write-organisations.ts";

const counts = await promotePendingCharityCommissionRecords();
console.log(counts);
