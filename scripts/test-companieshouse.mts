// Manual check: hit the live Companies House API and print the first shaped record.
// Writes nothing to the database.
//
//   npm run ingest:check-companies-house
//
// Needs COMPANIES_HOUSE_API_KEY in .env.local.

import { companiesHouseAdapter } from "../src/lib/ingestion/sources/companieshouse.ts";

const { records, truncated } = await companiesHouseAdapter.fetch();
console.log(`Got ${records.length} records (truncated: ${truncated})`);
console.log(records[0]);
