// scripts/test-companieshouse.mts
import { companiesHouseAdapter } from "../src/lib/ingestion/sources/companieshouse";

const records = await companiesHouseAdapter.fetch();
console.log(`Got ${records.length} records`);
console.log(records[0]);
