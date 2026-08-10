// Manual check: hit the live Companies House API and print the first shaped record.
// Writes nothing to the database.
//
//   npm run ingest:check-companies-house -- 00000006
//
// Needs COMPANIES_HOUSE_API_KEY in .env.local.

import { createCompaniesHouseAdapter } from "../src/lib/ingestion/sources/companieshouse.ts";

const companyNumber = process.argv[2];
if (!companyNumber) {
  throw new Error("Pass a company number: npm run ingest:check-companies-house -- 00000006");
}
const { records, truncated } = await createCompaniesHouseAdapter({
  companyNumber,
}).fetch();
console.log(`Got ${records.length} records (truncated: ${truncated})`);
console.log(records[0]);
