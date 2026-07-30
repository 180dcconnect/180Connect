// scripts/test-charitybase.mts
import { fetchFromCharityBase } from "../src/lib/ingestion/sources/charitybase";

const records = await fetchFromCharityBase();
console.log(`Got ${records.length} records`);
console.log(records[0]);
