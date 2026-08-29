import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchAllPages,
  promotePendingCharityCommissionRecords,
  promotePendingCompaniesHouseRecords,
  promotePendingFindThatCharityRecords,
  type OrganisationWriteStore,
  type PendingRecord,
} from "./write-organisations.ts";
import type { StandardOrganisation } from "./types.ts";
import type { RawCharityCommissionRecord } from "./charity-commission.ts";

// ---------------------------------------------------------------------------
// Fake store — same reasoning as runner.test.ts's fakeStore: assert against
// an in-memory implementation rather than a real database.
// ---------------------------------------------------------------------------

function fakeStore(overrides: Partial<OrganisationWriteStore> = {}) {
  const inserted: StandardOrganisation[] = [];
  const flagged: {
    rawRecordId: string;
    matchedOrganisationId: string;
    matchedOn: string;
    source: string;
    matchFields: Record<string, string>;
  }[] = [];
  const statusUpdates: {
    rawRecordId: string;
    status: string;
    matchedOrganisationId?: string;
  }[] = [];
  let nextId = 1;
  const criteriaOutcomes: { rawRecordId: string; outcome: string; reasons: string[] }[] = [];
  const fieldSources: {
    organisationId: string;
    org: StandardOrganisation;
    source: string;
    rawSourceRecordId: string;
  }[] = [];
  const identifiers: {
    organisationId: string;
    identifierType: "uk_charity" | "uk_company";
    identifierValue: string;
  }[] = [];
  const financialPeriods: {
    organisationId: string;
    periodStart: string;
    periodEnd: string;
    totalIncome: number | null;
    totalExpenditure: number | null;
    incomeBand: string | null;
  }[] = [];

  const store: OrganisationWriteStore = {
    async loadPendingRecords() {
      return [];
    },
    async loadExistingOrganisationsForMatching() {
      return [];
    },
    async loadDismissedMatches() {
      return [];
    },
    async insertOrganisation(org) {
      inserted.push(org);
      return { id: `org-${nextId++}` };
    },
    async flagPotentialDuplicate({ rawRecordId, matchedOrganisationId, matchedOn, source, matchFields }) {
      flagged.push({ rawRecordId, matchedOrganisationId, matchedOn, source, matchFields });
      return { id: `flag-${nextId++}` };
    },
    async markRecordStatus(rawRecordId, status, matchedOrganisationId) {
      statusUpdates.push({ rawRecordId, status, matchedOrganisationId });
    },
    async recordCriteriaOutcome(rawRecordId, result) {
      criteriaOutcomes.push({ rawRecordId, outcome: result.outcome, reasons: result.reasons });
      statusUpdates.push({ rawRecordId, status: "rejected" });
    },
    async recordFieldSources(organisationId, org, source, rawSourceRecordId) {
      fieldSources.push({ organisationId, org, source, rawSourceRecordId });
    },
    async upsertIdentifier(input) {
      identifiers.push(input);
      return { ok: true };
    },
    async upsertFinancialPeriod(input) {
      financialPeriods.push(input);
      return { ok: true };
    },
    ...overrides,
  };

  return {
    store,
    inserted,
    flagged,
    statusUpdates,
    criteriaOutcomes,
    fieldSources,
    identifiers,
    financialPeriods,
  };
}

function pendingRecord(
  id: string,
  charityName: string,
  regCharityNumber = 1,
  extraPayload: Record<string, unknown> = {},
): PendingRecord {
  return {
    id,
    // The organisation_number, not the charity number — the latter lives in
    // raw_payload.reg_charity_number and is what gets written as the uk_charity
    // identifier (same split as the live loader's select).
    source_record_id: String(regCharityNumber),
    raw_payload: {
      organisation_number: regCharityNumber,
      reg_charity_number: regCharityNumber,
      charity_name: charityName,
      reg_status: "R",
      date_of_registration: "2026-01-01T00:00:00",
      date_of_removal: null,
      ...extraPayload,
    },
  };
}

function companiesHousePendingRecord(
  id: string,
  companyName: string,
  companyNumber = "01234567",
): PendingRecord {
  return {
    id,
    // The normalised company number — the uk_company identifier value, same
    // as the live loader's source_record_id.
    source_record_id: companyNumber,
    raw_payload: {
      company_number: companyNumber,
      company_name: companyName,
    },
  };
}

function findThatCharityPendingRecord(
  id: string,
  queriedName: string,
  overrides: Partial<{ name: string; ftcId: string; score: number; match: boolean }> = {},
): PendingRecord {
  return {
    id,
    raw_payload: {
      queried_name: queriedName,
      name: overrides.name ?? `${queriedName} (${overrides.ftcId ?? "GB-CHC-1"})`,
      id: overrides.ftcId ?? "GB-CHC-1",
      score: overrides.score ?? 92,
      match: overrides.match ?? true,
    },
  };
}

const criteriaPass = () => ({
  outcome: "meets" as const,
  priority: "standard" as const,
  healthcareAligned: false,
  reasons: [],
});

describe("promotePendingCharityCommissionRecords — valid records", () => {
  it("maps and inserts every pending record, marking each validated", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [
          pendingRecord("raw-1", "Oxfam", 5254841),
          pendingRecord("raw-2", "Shelter", 234567),
        ];
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.read, 2);
    assert.equal(counts.inserted, 2);
    assert.equal(counts.rejected, 0);
    assert.equal(counts.failed, 0);
    assert.equal(inserted.length, 2);
    assert.equal(inserted[0].legal_name, "Oxfam");
    assert.equal(statusUpdates[0].status, "validated");
    assert.equal(statusUpdates[0].matchedOrganisationId, "org-1");
  });

  it("does nothing when there are no pending records", async () => {
    const { store, inserted } = fakeStore();
    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.read, 0);
    assert.equal(inserted.length, 0);
  });
});

describe("promotePendingCharityCommissionRecords — invalid records", () => {
  it("rejects a record with an empty charity_name instead of inserting it", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "")];
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.rejected, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(inserted.length, 0);
    assert.equal(statusUpdates[0].status, "rejected");
  });

  it("rejects a whitespace-only charity_name too", async () => {
    const { store, inserted } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "   ")];
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.rejected, 1);
    assert.equal(inserted.length, 0);
  });
});

describe("promotePendingCharityCommissionRecords — website validation", () => {
  it("flags a broken website during import without rejecting the organisation", async () => {
    const record = pendingRecord("raw-website", "Useful Charity");
    (record.raw_payload as RawCharityCommissionRecord).web = "https://broken.example";
    const checked: string[] = [];
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [record];
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store, async (website) => {
      checked.push(website);
      return {
        status: "unreachable",
        url: website,
        message: "Website did not respond.",
      };
    });

    assert.deepEqual(checked, ["https://broken.example"]);
    assert.equal(counts.inserted, 1);
    assert.equal(counts.rejected, 0);
    assert.equal(inserted[0].website, "https://broken.example");
    assert.equal(statusUpdates[0].status, "validated");
  });
});

describe("promotePendingCharityCommissionRecords — duplicate candidate (F042)", () => {
  it("flags a match instead of inserting a second organisations row", async () => {
    const { store, inserted, flagged, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Test Charity")];
      },
      async loadExistingOrganisationsForMatching() {
        return [{ id: "org-existing", legal_name: "Test Charity", postcode: "" }];
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.flagged, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(inserted.length, 0);
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].matchedOrganisationId, "org-existing");
    assert.equal(flagged[0].matchedOn, "name_and_postcode");
    assert.equal(flagged[0].source, "charity_commission");
    // The candidate's registry number is now part of the compared fields (F042's
    // registration-number branch is live), even when the name is what matched.
    assert.deepEqual(flagged[0].matchFields, {
      legal_name: "Test Charity",
      postcode: "",
      registrationNumbers: "1",
    });
    assert.equal(statusUpdates[0].status, "matched");
    assert.equal(statusUpdates[0].matchedOrganisationId, "org-existing");
  });

  it("still inserts a record with no match against existing organisations", async () => {
    const { store, inserted, flagged } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Test Charity")];
      },
      async loadExistingOrganisationsForMatching() {
        return [{ id: "org-existing", legal_name: "Unrelated Charity", postcode: "" }];
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.inserted, 1);
    assert.equal(counts.flagged, 0);
    assert.equal(inserted.length, 1);
    assert.equal(flagged.length, 0);
  });

  it("does not re-flag an organisation an admin already dismissed for this record", async () => {
    const { store, inserted, flagged } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Test Charity")];
      },
      async loadExistingOrganisationsForMatching() {
        return [{ id: "org-existing", legal_name: "Test Charity", postcode: "" }];
      },
      async loadDismissedMatches() {
        return ["org-existing"];
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.inserted, 1);
    assert.equal(counts.flagged, 0);
    assert.equal(inserted.length, 1);
    assert.equal(flagged.length, 0);
  });

  it("documents that conflicting-source-values detection is F048, not this layer", () => {
    // F041's testing notes also list "conflicting source values" — this layer only
    // decides new-vs-duplicate (F042); reconciling disagreeing field values between
    // two records is F048, flagged in write-organisations.ts's top comment as future
    // work, not silently skipped.
    assert.ok(true);
  });
});

describe("promotePendingCharityCommissionRecords — existing internal data preserved", () => {
  it("never updates or deletes an existing organisations row — only inserts new ones", async () => {
    // insertOrganisation is only ever called with `insert`, never `update` or
    // `upsert` — this test asserts the store contract rather than a live
    // database, but documents the intent: F041 as built here cannot touch
    // an existing row, by construction, since it has no matching logic yet.
    const { store, inserted } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Oxfam")];
      },
    });

    await promotePendingCharityCommissionRecords(store);

    assert.equal(inserted.length, 1);
  });
});

describe("promotePendingCharityCommissionRecords — field-level source tracking (F044)", () => {
  it("records field provenance for the inserted organisation, tagged with its source", async () => {
    const { store, fieldSources } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Oxfam")];
      },
    });

    await promotePendingCharityCommissionRecords(store);

    assert.equal(fieldSources.length, 1);
    assert.equal(fieldSources[0].organisationId, "org-1");
    assert.equal(fieldSources[0].source, "charity_commission");
    assert.equal(fieldSources[0].rawSourceRecordId, "raw-1");
    assert.equal(fieldSources[0].org.legal_name, "Oxfam");
  });

  it("does not record field sources for a rejected (invalid) record", async () => {
    const { store, fieldSources } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "")];
      },
    });

    await promotePendingCharityCommissionRecords(store);

    assert.equal(fieldSources.length, 0);
  });

  it("does not record field sources for a record flagged as a duplicate candidate", async () => {
    const { store, fieldSources } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Test Charity")];
      },
      async loadExistingOrganisationsForMatching() {
        return [{ id: "org-existing", legal_name: "Test Charity", postcode: "" }];
      },
    });

    await promotePendingCharityCommissionRecords(store);

    assert.equal(fieldSources.length, 0);
  });

  it("does not fail the insert or the batch when recording field sources errors", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [
          pendingRecord("raw-1", "Oxfam", 5254841),
          pendingRecord("raw-2", "Shelter", 234567),
        ];
      },
      async recordFieldSources() {
        throw new Error("rpc unavailable");
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    // The organisation itself is already committed by this point — a
    // provenance-recording failure is logged (reportError), not a reason to mark
    // an otherwise-successful insert as failed.
    assert.equal(counts.inserted, 2);
    assert.equal(counts.failed, 0);
    assert.equal(inserted.length, 2);
    assert.equal(statusUpdates[0].status, "validated");
  });
});

describe("promotePending*Records — registration-number dedup (F042 strongest key)", () => {
  it("charity commission: flags a match on registry number even when the name differs", async () => {
    const { store, inserted, flagged } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Totally Different Name", 5254841)];
      },
      async loadExistingOrganisationsForMatching() {
        return [
          {
            id: "org-existing",
            legal_name: "Oxfam",
            postcode: "",
            registrationNumbers: ["5254841"],
          },
        ];
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.flagged, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(inserted.length, 0);
    assert.equal(flagged[0].matchedOrganisationId, "org-existing");
    assert.equal(flagged[0].matchedOn, "registration_number");
    assert.equal(flagged[0].source, "charity_commission");
  });

  it("companies house: flags a match on registry number even when the name differs", async () => {
    const { store, inserted, flagged } = fakeStore({
      async loadPendingRecords() {
        return [companiesHousePendingRecord("raw-1", "Some Other Ltd", "01234567")];
      },
      async loadExistingOrganisationsForMatching() {
        return [
          {
            id: "org-existing",
            legal_name: "Acme Ltd",
            postcode: "",
            registrationNumbers: ["01234567"],
          },
        ];
      },
    });

    const counts = await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(counts.flagged, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(inserted.length, 0);
    assert.equal(flagged[0].matchedOn, "registration_number");
    assert.equal(flagged[0].source, "companies_house");
  });

  it("flags a later record in the same batch whose registry number matches an earlier insert", async () => {
    const { store, inserted, flagged } = fakeStore({
      async loadPendingRecords() {
        return [
          pendingRecord("raw-1", "Oxfam", 5254841),
          pendingRecord("raw-2", "Different Name Ltd", 5254841),
        ];
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.inserted, 1);
    assert.equal(counts.flagged, 1);
    assert.equal(inserted.length, 1);
    assert.equal(flagged[0].matchedOn, "registration_number");
    assert.equal(flagged[0].matchedOrganisationId, "org-1");
  });

  it("find that charity: flags on a GB-CHC registry number, matching the bare stored value", async () => {
    const { store, flagged } = fakeStore({
      async loadPendingRecords() {
        return [findThatCharityPendingRecord("raw-1", "Different Name", { ftcId: "GB-CHC-202918" })];
      },
      async loadExistingOrganisationsForMatching() {
        return [
          {
            id: "org-existing",
            legal_name: "Oxfam",
            postcode: "",
            registrationNumbers: ["202918"],
          },
        ];
      },
    });

    const counts = await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(counts.flagged, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(flagged[0].matchedOn, "registration_number");
    assert.equal(flagged[0].source, "find_that_charity");
  });
});

describe("promotePendingCharityCommissionRecords — registry identifiers", () => {
  it("writes the uk_charity identifier from reg_charity_number for every inserted record", async () => {
    const { store, identifiers } = fakeStore({
      async loadPendingRecords() {
        return [
          pendingRecord("raw-1", "Oxfam", 5254841),
          pendingRecord("raw-2", "Shelter", 234567),
        ];
      },
    });

    await promotePendingCharityCommissionRecords(store);

    assert.deepEqual(identifiers, [
      { organisationId: "org-1", identifierType: "uk_charity", identifierValue: "5254841" },
      { organisationId: "org-2", identifierType: "uk_charity", identifierValue: "234567" },
    ]);
  });

  it("writes no identifier for a record flagged as a duplicate candidate", async () => {
    const { store, identifiers } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Test Charity")];
      },
      async loadExistingOrganisationsForMatching() {
        return [{ id: "org-existing", legal_name: "Test Charity", postcode: "" }];
      },
    });

    await promotePendingCharityCommissionRecords(store);

    assert.equal(identifiers.length, 0);
  });

  it("does not fail the insert or the batch when writing the identifier errors", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [
          pendingRecord("raw-1", "Oxfam", 5254841),
          pendingRecord("raw-2", "Shelter", 234567),
        ];
      },
      async upsertIdentifier() {
        return { error: "insert failed" };
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    // The organisation itself is already committed by this point — an
    // identifier-write failure is logged (reportError), not a reason to mark
    // an otherwise-successful insert as failed, same as field provenance.
    assert.equal(counts.inserted, 2);
    assert.equal(counts.failed, 0);
    assert.equal(inserted.length, 2);
    assert.equal(statusUpdates[0].status, "validated");
  });
});

describe("promotePendingCharityCommissionRecords — financial periods", () => {
  it("writes a financial_periods row from latest_income/expenditure with the computed band", async () => {
    const { store, financialPeriods } = fakeStore({
      async loadPendingRecords() {
        return [
          pendingRecord("raw-1", "Oxfam", 5254841, {
            latest_income: "4314025",
            latest_expenditure: "4191442",
            latest_acc_fin_year_start_date: "2024-04-01T00:00:00",
            latest_acc_fin_year_end_date: "2025-03-31T00:00:00",
          }),
          // Below the £10k boundary — lands in a different band.
          pendingRecord("raw-2", "Shelter", 234567, {
            latest_income: "8000",
            latest_expenditure: "7900",
            latest_acc_fin_year_start_date: "2024-04-01T00:00:00",
            latest_acc_fin_year_end_date: "2025-03-31T00:00:00",
          }),
        ];
      },
    });

    await promotePendingCharityCommissionRecords(store);

    assert.deepEqual(financialPeriods, [
      {
        organisationId: "org-1",
        periodStart: "2024-04-01",
        periodEnd: "2025-03-31",
        totalIncome: 4314025,
        totalExpenditure: 4191442,
        incomeBand: "over_1m",
      },
      {
        organisationId: "org-2",
        periodStart: "2024-04-01",
        periodEnd: "2025-03-31",
        totalIncome: 8000,
        totalExpenditure: 7900,
        incomeBand: "under_10k",
      },
    ]);
  });

  it("writes no financial period for a record whose payload carries no figures", async () => {
    const { store, financialPeriods } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Oxfam", 5254841)];
      },
    });

    await promotePendingCharityCommissionRecords(store);

    assert.equal(financialPeriods.length, 0);
  });

  it("treats dates without figures as no filing (needs at least one figure)", async () => {
    const { store, financialPeriods } = fakeStore({
      async loadPendingRecords() {
        return [
          pendingRecord("raw-1", "Oxfam", 5254841, {
            latest_acc_fin_year_start_date: "2024-04-01T00:00:00",
            latest_acc_fin_year_end_date: "2025-03-31T00:00:00",
          }),
        ];
      },
    });

    await promotePendingCharityCommissionRecords(store);

    assert.equal(financialPeriods.length, 0);
  });

  it("does not fail the insert or the batch when writing the financial period errors", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [
          pendingRecord("raw-1", "Oxfam", 5254841, {
            latest_income: "4314025",
            latest_acc_fin_year_start_date: "2024-04-01T00:00:00",
            latest_acc_fin_year_end_date: "2025-03-31T00:00:00",
          }),
          pendingRecord("raw-2", "Shelter", 234567),
        ];
      },
      async upsertFinancialPeriod() {
        return { error: "insert failed" };
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    // Same as an identifier-write failure: the organisation is already
    // committed, so a failed financial-period write is logged, not a reason
    // to mark an otherwise-successful insert as failed.
    assert.equal(counts.inserted, 2);
    assert.equal(counts.failed, 0);
    assert.equal(inserted.length, 2);
    assert.equal(statusUpdates[0].status, "validated");
  });
});

describe("promotePendingCharityCommissionRecords — write failure", () => {
  it("marks a record 'error', not 'validated', when the insert fails", async () => {
    const { store, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Oxfam")];
      },
      async insertOrganisation() {
        return { error: "duplicate key value" };
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.failed, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(statusUpdates[0].status, "error");
  });

  it("continues processing the rest of the batch after one insert fails", async () => {
    let calls = 0;
    const { store, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Oxfam"), pendingRecord("raw-2", "Shelter")];
      },
      async insertOrganisation() {
        calls++;
        if (calls === 1) return { error: "boom" };
        return { id: "org-2" };
      },
    });

    const counts = await promotePendingCharityCommissionRecords(store);

    assert.equal(counts.failed, 1);
    assert.equal(counts.inserted, 1);
    assert.equal(statusUpdates.length, 2);
  });
});

describe("promotePendingCharityCommissionRecords — no store configured", () => {
  it("throws a clear error rather than a null-reference crash", async () => {
    await assert.rejects(
      () => promotePendingCharityCommissionRecords(null),
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});

describe("promotePendingCharityCommissionRecords — F047 client criteria", () => {
  it("checks every usable incoming record before inserting it", async () => {
    const checkedTypes: string[] = [];
    const { store, inserted } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Eligible Charity")];
      },
    });

    await promotePendingCharityCommissionRecords(
      store,
      async () => ({ status: "missing", url: null, message: "No website provided." }),
      (input) => {
      checkedTypes.push(input.organisationType);
      return { outcome: "meets", priority: "standard", healthcareAligned: false, reasons: [] };
      },
    );

    assert.deepEqual(checkedTypes, ["charity"]);
    assert.equal(inserted.length, 1);
  });

  it("holds a non-matching record instead of creating an active client", async () => {
    const { store, inserted, statusUpdates, criteriaOutcomes } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-1", "Needs Review")];
      },
    });

    const counts = await promotePendingCharityCommissionRecords(
      store,
      async () => ({ status: "missing", url: null, message: "No website provided." }),
      () => ({
        outcome: "needs_review",
        priority: "standard",
        healthcareAligned: false,
        reasons: ["Needs evidence of social purpose."],
      }),
    );

    assert.equal(inserted.length, 0);
    assert.equal(counts.rejected, 1);
    assert.equal(statusUpdates[0].status, "rejected");
    assert.equal(criteriaOutcomes[0].outcome, "needs_review");
    assert.deepEqual(criteriaOutcomes[0].reasons, ["Needs evidence of social purpose."]);
  });

  it("persists a definite failure with a different outcome from a review candidate", async () => {
    const { store, criteriaOutcomes } = fakeStore({
      async loadPendingRecords() {
        return [pendingRecord("raw-fail", "Commercial Firm")];
      },
    });
    await promotePendingCharityCommissionRecords(
      store,
      async () => ({ status: "missing", url: null, message: "No website provided." }),
      () => ({
        outcome: "does_not_meet",
        priority: "standard",
        healthcareAligned: false,
        reasons: ["Outside the configured target-client criteria."],
      }),
    );
    assert.equal(criteriaOutcomes[0].outcome, "does_not_meet");
  });
});

// ---------------------------------------------------------------------------
// promotePendingCompaniesHouseRecords (F260) — same shape of coverage as
// promotePendingCharityCommissionRecords above, asserted independently so a
// regression in one source's wiring doesn't hide behind the other's passing
// tests.
// ---------------------------------------------------------------------------

describe("promotePendingCompaniesHouseRecords — valid records", () => {
  it("holds an ambiguous company for admin review under the default F047 policy", async () => {
    const { store, inserted, criteriaOutcomes } = fakeStore({
      async loadPendingRecords() {
        return [companiesHousePendingRecord("raw-review", "Potential Social Enterprise Ltd")];
      },
    });
    const counts = await promotePendingCompaniesHouseRecords(store);
    assert.equal(inserted.length, 0);
    assert.equal(counts.rejected, 1);
    assert.equal(criteriaOutcomes[0].outcome, "needs_review");
  });

  it("maps and inserts every pending record, marking each validated", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [
          companiesHousePendingRecord("raw-1", "Acme Ltd", "01234567"),
          companiesHousePendingRecord("raw-2", "Beta Ltd", "09668396"),
        ];
      },
    });

    const counts = await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(counts.read, 2);
    assert.equal(counts.inserted, 2);
    assert.equal(counts.rejected, 0);
    assert.equal(counts.failed, 0);
    assert.equal(inserted.length, 2);
    assert.equal(inserted[0].legal_name, "Acme Ltd");
    assert.equal(inserted[0].organisation_type, "company");
    assert.equal(statusUpdates[0].status, "validated");
    assert.equal(statusUpdates[0].matchedOrganisationId, "org-1");
  });

  it("does nothing when there are no pending records", async () => {
    const { store, inserted } = fakeStore();
    const counts = await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(counts.read, 0);
    assert.equal(inserted.length, 0);
  });

  it("loads pending records filtered on the companies_house source", async () => {
    let requestedSource = "";
    const { store } = fakeStore({
      async loadPendingRecords(source) {
        requestedSource = source;
        return [];
      },
    });

    await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(requestedSource, "companies_house");
  });
});

describe("promotePendingCompaniesHouseRecords — invalid records", () => {
  it("rejects a record with an empty company_name instead of inserting it", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [companiesHousePendingRecord("raw-1", "")];
      },
    });

    const counts = await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(counts.rejected, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(inserted.length, 0);
    assert.equal(statusUpdates[0].status, "rejected");
  });

  it("rejects a whitespace-only company_name too", async () => {
    const { store, inserted } = fakeStore({
      async loadPendingRecords() {
        return [companiesHousePendingRecord("raw-1", "   ")];
      },
    });

    const counts = await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(counts.rejected, 1);
    assert.equal(inserted.length, 0);
  });
});

describe("promotePendingCompaniesHouseRecords — duplicate candidate (F042)", () => {
  it("flags a match instead of inserting a second organisations row", async () => {
    // Regression test for the merge conflict this branch's F042 work hit against
    // dev's F260 refactor, and again against dev's F262 refactor into three fully
    // bespoke promote functions: dedup must run inside *every* promotePending*Records
    // function, not just Charity Commission's, or Companies House (and Find That
    // Charity) records skip it silently.
    const { store, inserted, flagged, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [companiesHousePendingRecord("raw-1", "Acme Ltd")];
      },
      async loadExistingOrganisationsForMatching() {
        return [{ id: "org-existing", legal_name: "Acme Ltd", postcode: "" }];
      },
    });

    const counts = await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(counts.flagged, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(inserted.length, 0);
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].matchedOrganisationId, "org-existing");
    // The whole point of this regression test: source_priority must reflect the
    // record actually being promoted (companies_house here), not be left at
    // whatever the Charity Commission path happens to use.
    assert.equal(flagged[0].source, "companies_house");
    assert.equal(statusUpdates[0].status, "matched");
  });

  it("still inserts a record with no match against existing organisations", async () => {
    const { store, inserted, flagged } = fakeStore({
      async loadPendingRecords() {
        return [companiesHousePendingRecord("raw-1", "Acme Ltd")];
      },
      async loadExistingOrganisationsForMatching() {
        return [{ id: "org-existing", legal_name: "Unrelated Ltd", postcode: "" }];
      },
    });

    const counts = await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(counts.inserted, 1);
    assert.equal(counts.flagged, 0);
    assert.equal(inserted.length, 1);
    assert.equal(flagged.length, 0);
  });

  it("documents that conflicting-source-values detection and legal_name priority are F048, not this layer", () => {
    // Same reasoning as the charity_commission block above, plus the
    // Data Dictionary's "Companies House takes priority over CharityBase"
    // note for legal_name specifically — that's a merge-time decision
    // between two sources' records, which entity_match_candidates.source_priority
    // records but does not yet act on (no merge logic reads it) — F048's job.
    assert.ok(true);
  });
});

describe("promotePendingCompaniesHouseRecords — existing internal data preserved", () => {
  it("never updates or deletes an existing organisations row — only inserts new ones", async () => {
    const { store, inserted } = fakeStore({
      async loadPendingRecords() {
        return [companiesHousePendingRecord("raw-1", "Acme Ltd")];
      },
    });

    await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(inserted.length, 1);
  });
});

describe("promotePendingCompaniesHouseRecords — field-level source tracking (F044)", () => {
  it("records field provenance tagged with companies_house, not the other sources", async () => {
    const { store, fieldSources } = fakeStore({
      async loadPendingRecords() {
        return [companiesHousePendingRecord("raw-1", "Acme Ltd")];
      },
    });

    await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(fieldSources.length, 1);
    assert.equal(fieldSources[0].source, "companies_house");
    assert.equal(fieldSources[0].organisationId, "org-1");
  });
});

describe("promotePendingCompaniesHouseRecords — registry identifiers", () => {
  it("writes the uk_company identifier from source_record_id for every inserted record", async () => {
    const { store, identifiers } = fakeStore({
      async loadPendingRecords() {
        return [
          companiesHousePendingRecord("raw-1", "Acme Ltd", "01234567"),
          companiesHousePendingRecord("raw-2", "Beta Ltd", "09668396"),
        ];
      },
    });

    await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.deepEqual(identifiers, [
      { organisationId: "org-1", identifierType: "uk_company", identifierValue: "01234567" },
      { organisationId: "org-2", identifierType: "uk_company", identifierValue: "09668396" },
    ]);
  });

  it("writes no identifier when the record has no source_record_id", async () => {
    const record = companiesHousePendingRecord("raw-1", "Acme Ltd");
    record.source_record_id = null;
    const { store, identifiers } = fakeStore({
      async loadPendingRecords() {
        return [record];
      },
    });

    await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(identifiers.length, 0);
  });
});

describe("promotePendingCompaniesHouseRecords — write failure", () => {
  it("marks a record 'error', not 'validated', when the insert fails", async () => {
    const { store, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [companiesHousePendingRecord("raw-1", "Acme Ltd")];
      },
      async insertOrganisation() {
        return { error: "duplicate key value" };
      },
    });

    const counts = await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(counts.failed, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(statusUpdates[0].status, "error");
  });

  it("continues processing the rest of the batch after one insert fails", async () => {
    let calls = 0;
    const { store, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [
          companiesHousePendingRecord("raw-1", "Acme Ltd"),
          companiesHousePendingRecord("raw-2", "Beta Ltd"),
        ];
      },
      async insertOrganisation() {
        calls++;
        if (calls === 1) return { error: "boom" };
        return { id: "org-2" };
      },
    });

    const counts = await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(counts.failed, 1);
    assert.equal(counts.inserted, 1);
    assert.equal(statusUpdates.length, 2);
  });
});

describe("promotePendingCompaniesHouseRecords — no store configured", () => {
  it("throws a clear error rather than a null-reference crash", async () => {
    await assert.rejects(
      () => promotePendingCompaniesHouseRecords(null),
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});

describe("promotePendingCompaniesHouseRecords — malformed raw_payload", () => {
  it("marks a record as error and continues the batch when the mapper throws", async () => {
    // Regression: before the fix, a record with an unexpected raw_payload shape
    // (e.g. legacy format) would throw inside standardizeCompaniesHouseRecord
    // and crash the whole batch, leaving no error status on the failing record.
    let calls = 0;
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [
          // First record: null payload — mapper will throw
          { id: "raw-bad", raw_payload: null },
          // Second record: valid — should still be processed
          companiesHousePendingRecord("raw-good", "Good Charity Ltd"),
        ];
      },
      async insertOrganisation(org) {
        calls++;
        inserted.push(org);
        return { id: `org-${calls}` };
      },
    });

    const counts = await promotePendingCompaniesHouseRecords(store, criteriaPass);

    assert.equal(counts.failed, 1);
    assert.equal(counts.inserted, 1);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].legal_name, "Good Charity Ltd");
    assert.equal(statusUpdates[0].status, "error");
    assert.equal(statusUpdates[0].rawRecordId, "raw-bad");
    assert.equal(statusUpdates[1].status, "validated");
  });
});

// ---------------------------------------------------------------------------
// promotePendingFindThatCharityRecords (F262) — same shape of coverage as
// promotePendingCompaniesHouseRecords above, plus its own block for the
// match-confidence filter, which has no equivalent in either other source.
// ---------------------------------------------------------------------------

describe("promotePendingFindThatCharityRecords — valid records", () => {
  it("maps and inserts a confident match, marking it validated", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [findThatCharityPendingRecord("raw-1", "Oxfam", { ftcId: "GB-CHC-202918" })];
      },
    });

    const counts = await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(counts.read, 1);
    assert.equal(counts.inserted, 1);
    assert.equal(counts.rejected, 0);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].legal_name, "Oxfam");
    assert.equal(inserted[0].organisation_type, "charity");
    assert.equal(statusUpdates[0].status, "validated");
    assert.equal(statusUpdates[0].matchedOrganisationId, "org-1");
  });

  it("does nothing when there are no pending records", async () => {
    const { store, inserted } = fakeStore();
    const counts = await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(counts.read, 0);
    assert.equal(inserted.length, 0);
  });

  it("loads pending records filtered on the find_that_charity source", async () => {
    let requestedSource = "";
    const { store } = fakeStore({
      async loadPendingRecords(source) {
        requestedSource = source;
        return [];
      },
    });

    await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(requestedSource, "find_that_charity");
  });
});

describe("promotePendingFindThatCharityRecords — invalid records", () => {
  it("rejects a record with an empty queried_name instead of inserting it", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [findThatCharityPendingRecord("raw-1", "")];
      },
    });

    const counts = await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(counts.rejected, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(inserted.length, 0);
    assert.equal(statusUpdates[0].status, "rejected");
  });
});

describe("promotePendingFindThatCharityRecords — low-confidence match", () => {
  it("rejects a candidate with match: false rather than inserting reconcileOne's fallback guess", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [
          findThatCharityPendingRecord("raw-1", "Some Charity", { match: false, score: 12 }),
        ];
      },
    });

    const counts = await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(counts.rejected, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(inserted.length, 0);
    assert.equal(statusUpdates[0].status, "rejected");
  });

  it("still inserts a confident match even with a low numeric score", async () => {
    // match: true is the deciding signal, not score on its own — see
    // isConfidentMatch's doc comment.
    const { store, inserted } = fakeStore({
      async loadPendingRecords() {
        return [
          findThatCharityPendingRecord("raw-1", "Some Charity", { match: true, score: 20 }),
        ];
      },
    });

    const counts = await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(counts.inserted, 1);
    assert.equal(inserted.length, 1);
  });
});

describe("promotePendingFindThatCharityRecords — legal_name source", () => {
  it("uses queried_name, not Find That Charity's decorated name, for legal_name", async () => {
    const { store, inserted } = fakeStore({
      async loadPendingRecords() {
        return [
          findThatCharityPendingRecord("raw-1", "Oxfam International Tsunami Fund", {
            name: "Oxfam International Tsunami Fund (GB-CHC-1108700) [INACTIVE]",
            ftcId: "GB-CHC-1108700",
          }),
        ];
      },
    });

    await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(inserted[0].legal_name, "Oxfam International Tsunami Fund");
  });
});

describe("promotePendingFindThatCharityRecords — duplicate candidate (F042)", () => {
  it("flags a match instead of inserting a second organisations row", async () => {
    // Sharper than the equivalent charity_commission/companies_house test: every
    // find_that_charity record reconciles a name that already came from another
    // source, so this is the source where F042 matters most — see the
    // module-level comment at the top of write-organisations.ts.
    const { store, inserted, flagged, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [findThatCharityPendingRecord("raw-1", "Oxfam", { ftcId: "GB-CHC-202918" })];
      },
      async loadExistingOrganisationsForMatching() {
        return [{ id: "org-existing", legal_name: "Oxfam", postcode: "" }];
      },
    });

    const counts = await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(counts.flagged, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(inserted.length, 0);
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].matchedOrganisationId, "org-existing");
    assert.equal(flagged[0].source, "find_that_charity");
    assert.equal(statusUpdates[0].status, "matched");
  });

  it("still inserts a confident match with no existing organisation to match against", async () => {
    const { store, inserted, flagged } = fakeStore({
      async loadPendingRecords() {
        return [findThatCharityPendingRecord("raw-1", "Oxfam", { ftcId: "GB-CHC-202918" })];
      },
      async loadExistingOrganisationsForMatching() {
        return [{ id: "org-existing", legal_name: "Unrelated Charity", postcode: "" }];
      },
    });

    const counts = await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(counts.inserted, 1);
    assert.equal(counts.flagged, 0);
    assert.equal(inserted.length, 1);
    assert.equal(flagged.length, 0);
  });
});

describe("promotePendingFindThatCharityRecords — existing internal data preserved", () => {
  it("never updates or deletes an existing organisations row — only inserts new ones", async () => {
    const { store, inserted } = fakeStore({
      async loadPendingRecords() {
        return [findThatCharityPendingRecord("raw-1", "Oxfam")];
      },
    });

    await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(inserted.length, 1);
  });
});

describe("promotePendingFindThatCharityRecords — field-level source tracking (F044)", () => {
  it("records field provenance tagged with find_that_charity, not the other sources", async () => {
    const { store, fieldSources } = fakeStore({
      async loadPendingRecords() {
        return [findThatCharityPendingRecord("raw-1", "Oxfam", { ftcId: "GB-CHC-202918" })];
      },
    });

    await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(fieldSources.length, 1);
    assert.equal(fieldSources[0].source, "find_that_charity");
    assert.equal(fieldSources[0].organisationId, "org-1");
  });
});

describe("promotePendingFindThatCharityRecords — write failure", () => {
  it("marks a record 'error', not 'validated', when the insert fails", async () => {
    const { store, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [findThatCharityPendingRecord("raw-1", "Oxfam")];
      },
      async insertOrganisation() {
        return { error: "duplicate key value" };
      },
    });

    const counts = await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(counts.failed, 1);
    assert.equal(counts.inserted, 0);
    assert.equal(statusUpdates[0].status, "error");
  });
});

describe("promotePendingFindThatCharityRecords — no store configured", () => {
  it("throws a clear error rather than a null-reference crash", async () => {
    await assert.rejects(
      () => promotePendingFindThatCharityRecords(null),
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});

describe("promotePendingFindThatCharityRecords — malformed raw_payload", () => {
  it("marks a record as error and continues the batch when the mapper throws", async () => {
    let calls = 0;
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [
          { id: "raw-bad", raw_payload: null },
          findThatCharityPendingRecord("raw-good", "Good Charity"),
        ];
      },
      async insertOrganisation(org) {
        calls++;
        inserted.push(org);
        return { id: `org-${calls}` };
      },
    });

    const counts = await promotePendingFindThatCharityRecords(store, criteriaPass);

    assert.equal(counts.failed, 1);
    assert.equal(counts.inserted, 1);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].legal_name, "Good Charity");
    assert.equal(statusUpdates[0].status, "error");
    assert.equal(statusUpdates[0].rawRecordId, "raw-bad");
    assert.equal(statusUpdates[1].status, "validated");
  });
});

describe("fetchAllPages", () => {
  it("keeps fetching until a page comes back shorter than the page size", async () => {
    // loadExistingOrganisationsForMatching's real Supabase implementation uses
    // this to page past PostgREST's 1000-row default cap on an unbounded
    // .select() — without it, matching silently stops seeing organisations
    // past row 1000 and never recovers on a later run.
    const PAGE_SIZE = 1000;
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `org-${i}` }));
    const lastPage = [{ id: "org-last" }];
    const requestedRanges: [number, number][] = [];

    const result = await fetchAllPages<{ id: string }>(async (from, to) => {
      requestedRanges.push([from, to]);
      return { data: from === 0 ? fullPage : lastPage, error: null };
    });

    assert.deepEqual(requestedRanges, [
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    ]);
    assert.equal(result.length, PAGE_SIZE + 1);
    assert.equal(result[result.length - 1].id, "org-last");
  });

  it("stops after one call when the first page is already short", async () => {
    const result = await fetchAllPages<{ id: string }>(async () => ({
      data: [{ id: "org-1" }],
      error: null,
    }));

    assert.deepEqual(result, [{ id: "org-1" }]);
  });

  it("throws instead of swallowing a page error", async () => {
    await assert.rejects(
      () => fetchAllPages(async () => ({ data: null, error: new Error("boom") })),
      /boom/,
    );
  });
});
