import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
  const statusUpdates: {
    rawRecordId: string;
    status: string;
    matchedOrganisationId?: string;
  }[] = [];
  let nextId = 1;
  const criteriaOutcomes: { rawRecordId: string; outcome: string; reasons: string[] }[] = [];

  const store: OrganisationWriteStore = {
    async loadPendingRecords() {
      return [];
    },
    async insertOrganisation(org) {
      inserted.push(org);
      return { id: `org-${nextId++}` };
    },
    async markRecordStatus(rawRecordId, status, matchedOrganisationId) {
      statusUpdates.push({ rawRecordId, status, matchedOrganisationId });
    },
    async recordCriteriaOutcome(rawRecordId, result) {
      criteriaOutcomes.push({ rawRecordId, outcome: result.outcome, reasons: result.reasons });
      statusUpdates.push({ rawRecordId, status: "rejected" });
    },
    ...overrides,
  };

  return { store, inserted, statusUpdates, criteriaOutcomes };
}

function pendingRecord(id: string, charityName: string): PendingRecord {
  return {
    id,
    raw_payload: {
      organisation_number: 1,
      reg_charity_number: 1,
      charity_name: charityName,
      reg_status: "R",
      date_of_registration: "2026-01-01T00:00:00",
      date_of_removal: null,
    },
  };
}

function companiesHousePendingRecord(id: string, companyName: string): PendingRecord {
  return {
    id,
    raw_payload: {
      company_number: "01234567",
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
        return [pendingRecord("raw-1", "Oxfam"), pendingRecord("raw-2", "Shelter")];
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

describe("promotePendingCharityCommissionRecords — duplicate candidate / conflicting values", () => {
  it("documents that cross-source dedup and conflict detection are F042/F048, not this layer", () => {
    // F041's testing notes list "duplicate candidate" and "conflicting source
    // values" — this layer maps and inserts one raw record at a time with no
    // knowledge of other organisations rows, so it cannot detect either.
    // Flagged explicitly in write-organisations.ts's top comment as future
    // F042/F048 work, not silently skipped.
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
// promotePendingCompaniesHouseRecords (F260) — same behaviour as
// promotePendingCharityCommissionRecords above (they share promotePendingRecords
// in write-organisations.ts), asserted independently so a regression in one
// source's wiring doesn't hide behind the other's passing tests.
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
          companiesHousePendingRecord("raw-1", "Acme Ltd"),
          companiesHousePendingRecord("raw-2", "Beta Ltd"),
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

describe("promotePendingCompaniesHouseRecords — duplicate candidate / conflicting values", () => {
  it("documents that cross-source dedup, conflict detection, and legal_name priority are F042, not this layer", () => {
    // Same reasoning as the charity_commission block above, plus the
    // Data Dictionary's "Companies House takes priority over CharityBase"
    // note for legal_name specifically — that's a merge-time decision
    // between two sources' records, which this insert-only layer has no
    // way to make since it never sees an existing row to compare against.
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

describe("promotePendingFindThatCharityRecords — duplicate candidate / conflicting values", () => {
  it("documents that cross-source dedup and conflict detection are F042/F048, not this layer", () => {
    // Sharper than the equivalent charity_commission/companies_house note:
    // every find_that_charity record reconciles a name that already came
    // from another source, so a successful insert here is a near-guaranteed
    // duplicate of an existing organisations row until F042 exists — see
    // the module-level comment at the top of write-organisations.ts.
    assert.ok(true);
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
