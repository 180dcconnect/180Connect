// Manual check: a failing adapter must not stop the ones after it.
//
//   npm run ingest:check-isolation
//
// Expect the broken source to log a failure and its ingestion_runs row to end as
// 'failed', while Companies House still runs and completes. Writes to the database.

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

console.table(await runIngestion([brokenAdapter, companiesHouseAdapter]));
