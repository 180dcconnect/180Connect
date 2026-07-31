// scripts/test-isolation.mts
import { runIngestion } from "../src/lib/ingestion/runner.ts";
import { companiesHouseAdapter } from "../src/lib/ingestion/sources/companieshouse.ts";
import type { DataSourceAdapter } from "../src/lib/ingestion/type.ts";

const brokenAdapter: DataSourceAdapter = {
  name: "charitybase",
  async fetch() {
    throw new Error("Simulated failure for testing isolation");
  },
  onError(err) {
    console.error(`[fake-broken-source] failed as expected:`, err.message);
  },
};

await runIngestion([brokenAdapter, companiesHouseAdapter]);
