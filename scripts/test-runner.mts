// scripts/test-runner.mts
import { runIngestion } from "../src/lib/ingestion/runner";
import { companiesHouseAdapter } from "../src/lib/ingestion/sources/companieshouse";

await runIngestion([companiesHouseAdapter]);
