// Manual check: hit the live Charity Commission API and print the first shaped record.
// Writes nothing to the database.
//
//   npm run ingest:check-charity-commission
//
// Needs CHARITY_COMMISSION_API_KEY in .env.local.
import { charityCommissionAdapter } from "../src/lib/ingestion/sources/charity-commission.ts";

const { records, truncated } = await charityCommissionAdapter.fetch();
console.log(`Got ${records.length} records (truncated: ${truncated})`);
console.log(records[0]);
