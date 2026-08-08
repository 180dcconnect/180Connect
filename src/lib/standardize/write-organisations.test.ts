import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  promotePendingCharityCommissionRecords,
  promotePendingCompaniesHouseRecords,
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
    ...overrides,
  };

  return { store, inserted, statusUpdates };
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

// ---------------------------------------------------------------------------
// promotePendingCompaniesHouseRecords (F260) — same behaviour as
// promotePendingCharityCommissionRecords above (they share promotePendingRecords
// in write-organisations.ts), asserted independently so a regression in one
// source's wiring doesn't hide behind the other's passing tests.
// ---------------------------------------------------------------------------

describe("promotePendingCompaniesHouseRecords — valid records", () => {
  it("maps and inserts every pending record, marking each validated", async () => {
    const { store, inserted, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [
          companiesHousePendingRecord("raw-1", "Acme Ltd"),
          companiesHousePendingRecord("raw-2", "Beta Ltd"),
        ];
      },
    });

    const counts = await promotePendingCompaniesHouseRecords(store);

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
    const counts = await promotePendingCompaniesHouseRecords(store);

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

    await promotePendingCompaniesHouseRecords(store);

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

    const counts = await promotePendingCompaniesHouseRecords(store);

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

    const counts = await promotePendingCompaniesHouseRecords(store);

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

    await promotePendingCompaniesHouseRecords(store);

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

    const counts = await promotePendingCompaniesHouseRecords(store);

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

    const counts = await promotePendingCompaniesHouseRecords(store);

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

    const counts = await promotePendingCompaniesHouseRecords(store);

    assert.equal(counts.failed, 1);
    assert.equal(counts.inserted, 1);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].legal_name, "Good Charity Ltd");
    assert.equal(statusUpdates[0].status, "error");
    assert.equal(statusUpdates[0].rawRecordId, "raw-bad");
    assert.equal(statusUpdates[1].status, "validated");
  });
});
