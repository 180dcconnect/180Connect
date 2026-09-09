import assert from "node:assert/strict";
import { test } from "node:test";

import type { BulkFinancialPeriodRow } from "../financials/charity-financial-periods.ts";
import {
  patchesFor,
  writeBatchesFor,
  type BackfillTarget,
  type PeriodPatch,
  type StoredPeriod,
} from "./annual-return-backfill.ts";

/** A stored period with everything blank, which is what the API path leaves. */
function stored(overrides: Partial<StoredPeriod> = {}): StoredPeriod {
  return {
    period_start: "2024-04-01",
    period_end: "2025-03-31",
    filing_date: null,
    count_employees: null,
    count_volunteers: null,
    receives_govt_grants: null,
    receives_govt_contracts: null,
    count_govt_grants: null,
    count_govt_contracts: null,
    ...overrides,
  };
}

/** The same year as the register publishes it. Oxfam's 2025 return, in fact. */
function fromRegister(
  overrides: Partial<BulkFinancialPeriodRow> = {},
): BulkFinancialPeriodRow {
  return {
    periodStart: "2024-04-01",
    periodEnd: "2025-03-31",
    totalIncome: 339_366_903,
    totalExpenditure: null,
    incomeBand: null,
    incomeDonationsLegacies: null,
    incomeCharitableActivities: null,
    incomeOtherTrading: null,
    incomeInvestment: null,
    incomeEndowments: null,
    incomeOther: null,
    incomeGovtGrants: null,
    incomeGovtContracts: null,
    expenditureCharitableActivities: null,
    expenditureRaisingFunds: null,
    expenditureGovernance: null,
    expenditureGrantsInstitutions: null,
    expenditureInvestmentManagement: null,
    expenditureOther: null,
    filingDate: "2025-12-18",
    countEmployees: 4084,
    countVolunteers: 28920,
    receivesGovtGrants: true,
    receivesGovtContracts: false,
    countGovtGrants: 3,
    countGovtContracts: null,
    ...overrides,
  } as BulkFinancialPeriodRow;
}

test("fills every Part B column the stored period is missing", () => {
  const patches = patchesFor([stored()], [fromRegister()]);

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0], {
    periodStart: "2024-04-01",
    periodEnd: "2025-03-31",
    filing_date: "2025-12-18",
    count_employees: 4084,
    count_volunteers: 28920,
    receives_govt_grants: true,
    receives_govt_contracts: false,
    count_govt_grants: 3,
    count_govt_contracts: null,
  });
});

test("a filed false is written, because false is a claim and null is not", () => {
  const [patch] = patchesFor([stored()], [fromRegister()]);
  assert.equal(patch.receives_govt_contracts, false);
});

test("never overwrites a value already on the record", () => {
  const patches = patchesFor(
    [stored({ count_employees: 12, filing_date: "2025-01-01" })],
    [fromRegister()],
  );

  assert.equal(patches[0].count_employees, null, "the held staff count stands");
  assert.equal(patches[0].filing_date, null, "the held filing date stands");
  assert.equal(patches[0].count_volunteers, 28920, "the gap beside it is still filled");
});

test("a period with nothing to add produces no patch at all", () => {
  const patches = patchesFor(
    [
      stored({
        filing_date: "2025-12-18",
        count_employees: 4084,
        count_volunteers: 28920,
        receives_govt_grants: true,
        receives_govt_contracts: false,
        count_govt_grants: 3,
      }),
    ],
    [fromRegister()],
  );

  assert.deepEqual(patches, [], "which is what keeps the coverage figure honest");
});

test("an entry-level filer the register knows nothing more about is never pending", () => {
  const patches = patchesFor(
    [stored()],
    [
      fromRegister({
        filingDate: null,
        countEmployees: null,
        countVolunteers: null,
        receivesGovtGrants: null,
        receivesGovtContracts: null,
        countGovtGrants: null,
        countGovtContracts: null,
      }),
    ],
  );

  assert.deepEqual(patches, [], "otherwise the job could never finish");
});

test("a filed year we hold no row for is left to the import", () => {
  const patches = patchesFor(
    [stored({ period_start: "2023-04-01", period_end: "2024-03-31" })],
    [fromRegister()],
  );

  assert.deepEqual(patches, []);
});

test("the patch carries the stored start, not the register's", () => {
  // A day's disagreement between the two sources would miss the upsert's
  // conflict key and insert a duplicate filed year rather than updating one.
  const [patch] = patchesFor(
    [stored({ period_start: "2024-04-02" })],
    [fromRegister({ periodStart: "2024-04-01" })],
  );

  assert.equal(patch.periodStart, "2024-04-02");
});

test("a stored period with no start is skipped rather than guessed at", () => {
  const patches = patchesFor([stored({ period_start: null })], [fromRegister()]);
  assert.deepEqual(patches, []);
});

test("matches year by year across a full history", () => {
  const patches = patchesFor(
    [
      stored({ period_start: "2023-04-01", period_end: "2024-03-31" }),
      stored({ period_start: "2024-04-01", period_end: "2025-03-31", count_employees: 4084 }),
    ],
    [
      fromRegister({
        periodStart: "2023-04-01",
        periodEnd: "2024-03-31",
        countEmployees: 4209,
        countVolunteers: 26000,
      }),
      fromRegister(),
    ],
  );

  assert.equal(patches.length, 2);
  assert.equal(patches[0].count_employees, 4209);
  assert.equal(patches[1].count_employees, null, "already held for the newer year");
  assert.equal(patches[1].count_volunteers, 28920);
});

/**
 * The write, not the patch.
 *
 * `patchesFor` returns null for "no gap here", and the first version of the
 * writer put that null straight into the upsert payload — where PostgREST's
 * `ON CONFLICT ... DO UPDATE SET` writes it as an actual null over whatever the
 * record already held. The tests above all passed while that was true, because
 * they check the patch object and the damage happened one step later. These
 * check the payload.
 */

/** A target holding one patch, for readability below. */
function target(patch: Partial<PeriodPatch>): BackfillTarget {
  return {
    organisationId: "org-1",
    charityNumber: "202918",
    patches: [
      {
        periodStart: "2024-04-01",
        periodEnd: "2025-03-31",
        filing_date: null,
        count_employees: null,
        count_volunteers: null,
        receives_govt_grants: null,
        receives_govt_contracts: null,
        count_govt_grants: null,
        count_govt_contracts: null,
        ...patch,
      },
    ],
  };
}

test("a column that is not being filled never reaches the payload", () => {
  const [batch] = writeBatchesFor([target({ count_employees: 4084 })]);

  assert.deepEqual(Object.keys(batch.rows[0]).sort(), [
    "count_employees",
    "financial_source",
    "organisation_id",
    "period_end",
    "period_start",
  ]);
  assert.equal(
    "filing_date" in batch.rows[0],
    false,
    "present-and-null is what wiped 2,205 filing dates on staging",
  );
});

test("every payload carries the full conflict key", () => {
  const [batch] = writeBatchesFor([target({ count_volunteers: 28920 })]);

  assert.equal(batch.rows[0].organisation_id, "org-1");
  assert.equal(batch.rows[0].period_start, "2024-04-01");
  assert.equal(batch.rows[0].period_end, "2025-03-31");
  assert.equal(batch.rows[0].financial_source, "charity_commission");
});

test("a filed false is carried through, not mistaken for an empty column", () => {
  const [batch] = writeBatchesFor([target({ receives_govt_contracts: false })]);

  assert.equal("receives_govt_contracts" in batch.rows[0], true);
  assert.equal(batch.rows[0].receives_govt_contracts, false);
});

test("rows are grouped so one request only ever carries one row shape", () => {
  const batches = writeBatchesFor([
    target({ count_employees: 1 }),
    { ...target({ count_employees: 2 }), organisationId: "org-2" },
    { ...target({ filing_date: "2025-12-18" }), organisationId: "org-3" },
  ]);

  assert.equal(batches.length, 2);
  for (const batch of batches) {
    const shapes = new Set(batch.rows.map((row) => Object.keys(row).sort().join(",")));
    assert.equal(shapes.size, 1, "PostgREST builds its SET list from the payload");
  }

  const staff = batches.find((batch) => batch.columns.join() === "count_employees");
  assert.equal(staff?.rows.length, 2, "the two staff-only rows share a request");
});

test("no batch is produced for a patch that fills nothing", () => {
  assert.deepEqual(writeBatchesFor([target({})]), []);
});
