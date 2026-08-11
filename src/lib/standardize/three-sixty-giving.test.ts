import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  promotePendingThreeSixtyGivingRecords,
  standardizeThreeSixtyGivingRecord,
  type GrantWriteStore,
  type StandardGrant,
} from "./three-sixty-giving.ts";
import type { PendingRecord } from "./write-organisations.ts";

function fakeStore(overrides: Partial<GrantWriteStore> = {}) {
  const upserts: { organisationId: string; grant: StandardGrant }[] = [];
  const statusUpdates: { rawRecordId: string; status: string; matchedOrganisationId?: string }[] = [];

  const store: GrantWriteStore = {
    async loadPendingRecords() {
      return [];
    },
    async findOrganisationByCharityNumber() {
      return null;
    },
    async findOrganisationByCompanyNumber() {
      return null;
    },
    async upsertGrant(organisationId, grant) {
      upserts.push({ organisationId, grant });
      return { ok: true };
    },
    async markRecordStatus(rawRecordId, status, matchedOrganisationId) {
      statusUpdates.push({ rawRecordId, status, matchedOrganisationId });
    },
    ...overrides,
  };

  return { store, upserts, statusUpdates };
}

function pendingGrant(id: string, overrides: Record<string, unknown> = {}): PendingRecord {
  return {
    id,
    raw_payload: {
      id: `360G-funder-${id}`,
      title: "Grant to Example Charity",
      currency: "GBP",
      awardDate: "2022-02-21T00:00:00+00:00",
      amountAwarded: 90000,
      description: "Core costs",
      grantProgramme: [{ title: "Bridging Divides" }],
      fundingOrganization: [{ name: "The Tudor Trust" }],
      recipientOrganization: [{ charityNumber: "1164883", companyNumber: "09668396" }],
      ...overrides,
    },
  };
}

describe("standardizeThreeSixtyGivingRecord", () => {
  it("maps the confirmed-live grant shape into a GRANTS row and recipient identifiers", () => {
    const { grant, recipient } = standardizeThreeSixtyGivingRecord({
      id: "360G-tudortrust-97915",
      title: "Grant to 360 Giving",
      currency: "GBP",
      awardDate: "2022-02-21T00:00:00+00:00",
      amountAwarded: 90000,
      description: "core costs",
      grantProgramme: [{ title: "Bridging Divides" }],
      fundingOrganization: [{ name: "The Tudor Trust" }],
      recipientOrganization: [{ charityNumber: "1164883", companyNumber: "09668396" }],
    });

    assert.deepEqual(grant, {
      grant_id: "360G-tudortrust-97915",
      funder_name: "The Tudor Trust",
      amount_awarded: 90000,
      currency: "GBP",
      award_date: "2022-02-21",
      grant_programme: "Bridging Divides",
      description: "core costs",
    });
    assert.deepEqual(recipient, { charityNumber: "1164883", companyNumber: "09668396" });
  });

  it("throws on a record with no usable grant id", () => {
    assert.throws(() => standardizeThreeSixtyGivingRecord({ id: "  " }));
    assert.throws(() => standardizeThreeSixtyGivingRecord({}));
  });

  it("falls back to defaults for missing funder name and currency", () => {
    const { grant } = standardizeThreeSixtyGivingRecord({ id: "360G-x" });
    assert.equal(grant.funder_name, "Unknown funder");
    assert.equal(grant.currency, "GBP");
    assert.equal(grant.amount_awarded, null);
    assert.equal(grant.award_date, null);
  });
});

describe("promotePendingThreeSixtyGivingRecords", () => {
  it("matches on charity number and upserts into GRANTS, marking the record matched", async () => {
    const { store, upserts, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [pendingGrant("r1")];
      },
      async findOrganisationByCharityNumber(charityNumber) {
        assert.equal(charityNumber, "1164883");
        return { id: "org-1" };
      },
    });

    const counts = await promotePendingThreeSixtyGivingRecords(store);

    assert.equal(counts.matched, 1);
    assert.equal(counts.unmatched, 0);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].organisationId, "org-1");
    assert.deepEqual(statusUpdates, [{ rawRecordId: "r1", status: "matched", matchedOrganisationId: "org-1" }]);
  });

  it("falls back to company number when charity number does not match", async () => {
    const { store, upserts } = fakeStore({
      async loadPendingRecords() {
        return [pendingGrant("r1")];
      },
      async findOrganisationByCharityNumber() {
        return null;
      },
      async findOrganisationByCompanyNumber(companyNumber) {
        assert.equal(companyNumber, "09668396");
        return { id: "org-2" };
      },
    });

    const counts = await promotePendingThreeSixtyGivingRecords(store);

    assert.equal(counts.matched, 1);
    assert.equal(upserts[0].organisationId, "org-2");
  });

  it("rejects an unmatched record without creating an organisation", async () => {
    const { store, upserts, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [pendingGrant("r1")];
      },
    });

    const counts = await promotePendingThreeSixtyGivingRecords(store);

    assert.equal(counts.unmatched, 1);
    assert.equal(counts.matched, 0);
    assert.equal(upserts.length, 0);
    assert.deepEqual(statusUpdates, [{ rawRecordId: "r1", status: "rejected", matchedOrganisationId: undefined }]);
  });

  it("rejects a record with no usable grant id as invalid data, not unmatched", async () => {
    const { store, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [{ id: "r1", raw_payload: { title: "no id here" } }];
      },
      async findOrganisationByCharityNumber() {
        throw new Error("should not be called for an invalid record");
      },
    });

    const counts = await promotePendingThreeSixtyGivingRecords(store);

    assert.equal(counts.invalidData, 1);
    assert.equal(counts.unmatched, 0);
    assert.deepEqual(statusUpdates, [{ rawRecordId: "r1", status: "rejected", matchedOrganisationId: undefined }]);
  });

  it("marks the record as error, not matched, when the grant upsert itself fails", async () => {
    const { store, statusUpdates } = fakeStore({
      async loadPendingRecords() {
        return [pendingGrant("r1")];
      },
      async findOrganisationByCharityNumber() {
        return { id: "org-1" };
      },
      async upsertGrant() {
        return { error: "duplicate key" };
      },
    });

    const counts = await promotePendingThreeSixtyGivingRecords(store);

    assert.equal(counts.failed, 1);
    assert.equal(counts.matched, 0);
    assert.deepEqual(statusUpdates, [{ rawRecordId: "r1", status: "error", matchedOrganisationId: undefined }]);
  });
});
