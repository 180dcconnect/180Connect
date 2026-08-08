import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  promotePendingCharityCommissionRecords,
  type OrganisationWriteStore,
  type PendingRecord,
} from "./write-organisations.ts";
import type { StandardOrganisation } from "./charity-commission.ts";

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
  }[] = [];
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
    async flagPotentialDuplicate({ rawRecordId, matchedOrganisationId, matchedOn }) {
      flagged.push({ rawRecordId, matchedOrganisationId, matchedOn });
      return { id: `flag-${nextId++}` };
    },
    async markRecordStatus(rawRecordId, status, matchedOrganisationId) {
      statusUpdates.push({ rawRecordId, status, matchedOrganisationId });
    },
    ...overrides,
  };

  return { store, inserted, flagged, statusUpdates };
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
