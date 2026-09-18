// Manual check: hit the live Charity Commission API and print the first shaped
// record. Writes nothing to the database.
//
//   npm run ingest:check-charity-commission
//
// Runs the discovery adapter, which reads its start date from the watermark in
// raw_source_records — so this needs the Supabase env vars too, not only the API
// key, even though it writes nothing.
//
// Needs CHARITY_COMMISSION_API_KEY in .env.local.
import { createCharityCommissionDiscoveryAdapter } from "../src/lib/ingestion/sources/charity-commission.ts";

const { records, truncated, stats } = await createCharityCommissionDiscoveryAdapter().fetch();
console.log(`Got ${records.length} records (truncated: ${truncated})`);
if (stats) {
  console.log(
    `${stats.registeredNationally} registered nationally in the window, ` +
      `${stats.local} in the branch's postcode areas.`,
  );
}
console.log(records[0]);
