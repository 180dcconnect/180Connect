import { runIngestion } from "../src/lib/ingestion/runner.ts";
import { companiesHouseAdapter } from "../src/lib/ingestion/sources/companieshouse.ts";

await runIngestion([companiesHouseAdapter]);
