// Manual check: a failing adapter must not stop the ones after it.
//
//   npm run ingest:check-isolation -- 00000006
//
// Expect the broken source to log a failure and its ingestion_runs row to end as
// 'failed', while Companies House still runs and completes. Writes to the database.

import { runIngestion } from "../src/lib/ingestion/runner.ts";
import { createCompaniesHouseAdapter } from "../src/lib/ingestion/sources/companieshouse.ts";
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

const companyNumber = process.argv[2];
if (!companyNumber) {
  throw new Error("Pass a company number: npm run ingest:check-isolation -- 00000006");
}

console.table(
  await runIngestion([
    brokenAdapter,
    createCompaniesHouseAdapter({ companyNumber }),
  ]),
);
