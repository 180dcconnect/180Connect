import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectAndFlagDiscrepancies,
  findFieldDiscrepancies,
  type DiscrepancyDetectionStore,
  type DiscrepancyField,
} from "./detect-field-discrepancies.ts";
import type { StandardOrganisation } from "../standardize/types.ts";

function org(overrides: Partial<Pick<StandardOrganisation, DiscrepancyField>> = {}) {
  return {
    legal_name: "Test Charity",
    website: "https://test-charity.org",
    contact_email: "hello@test-charity.org",
    address_line_1: "1 Test Street",
    city: "London",
    postcode: "SW1A 1AA",
    ...overrides,
  };
}

describe("findFieldDiscrepancies", () => {
  it("flags a field where both sides are non-empty and differ", () => {
    const result = findFieldDiscrepancies(
      org({ contact_email: "new@test-charity.org" }),
      org({ contact_email: "old@test-charity.org" }),
    );
    assert.deepEqual(result, [
      { fieldName: "contact_email", existingValue: "old@test-charity.org", incomingValue: "new@test-charity.org" },
    ]);
  });

  it("does not flag a field where both sides agree", () => {
    const result = findFieldDiscrepancies(org(), org());
    assert.deepEqual(result, []);
  });

  it("does not flag a field where either side is empty — a fill-in, not a conflict", () => {
    const result = findFieldDiscrepancies(
      org({ website: "https://test-charity.org" }),
      org({ website: "" }),
    );
    assert.deepEqual(result, []);
  });

  it("flags every differing field independently", () => {
    const result = findFieldDiscrepancies(
      org({ city: "Manchester", postcode: "M1 1AA" }),
      org({ city: "London", postcode: "SW1A 1AA" }),
    );
    assert.deepEqual(
      result.map((d) => d.fieldName).sort(),
      ["city", "postcode"],
    );
  });

  it("ignores a field outside the given allowlist even if it differs", () => {
    const result = findFieldDiscrepancies(org({ city: "Manchester" }), org({ city: "London" }), [
      "legal_name",
    ]);
    assert.deepEqual(result, []);
  });
});

function fakeStore(overrides: Partial<DiscrepancyDetectionStore> = {}): DiscrepancyDetectionStore & {
  recorded: Parameters<DiscrepancyDetectionStore["recordDiscrepancy"]>[0][];
} {
  const recorded: Parameters<DiscrepancyDetectionStore["recordDiscrepancy"]>[0][] = [];
  return {
    recorded,
    async loadEntityMatchCandidate() {
      return { rawSourceRecordId: "raw-1", candidateOrganisationId: "org-1" };
    },
    async loadRawSourceRecord() {
      return {
        recordSource: "companies_house",
        rawPayload: {
          company_name: "Test Charity",
          registered_office_address: { address_line_1: "1 Test Street", locality: "London", postal_code: "SW1A 1AA" },
        },
      };
    },
    async loadOrganisationForComparison() {
      return { organisation: org(), source: "charity_commission" };
    },
    async recordDiscrepancy(input) {
      recorded.push(input);
      return { ok: true };
    },
    ...overrides,
  };
}

describe("detectAndFlagDiscrepancies", () => {
  it("dispatches to the standardize function matching the raw record's source and flags each differing field", async () => {
    const store = fakeStore({
      async loadOrganisationForComparison() {
        return { organisation: org({ address_line_1: "99 Old Road" }), source: "charity_commission" };
      },
    });

    const result = await detectAndFlagDiscrepancies("candidate-1", store);

    assert.equal(result.flagged, 1);
    assert.equal(store.recorded.length, 1);
    assert.equal(store.recorded[0].fieldName, "address_line_1");
    assert.equal(store.recorded[0].existingValue, "99 Old Road");
    assert.equal(store.recorded[0].incomingValue, "1 Test Street");
    assert.equal(store.recorded[0].existingSource, "charity_commission");
    assert.equal(store.recorded[0].incomingSource, "companies_house");
  });

  it("flags nothing when the mapped incoming record agrees with the existing organisation", async () => {
    const store = fakeStore();
    const result = await detectAndFlagDiscrepancies("candidate-1", store);
    assert.equal(result.flagged, 0);
    assert.equal(store.recorded.length, 0);
  });

  it("reports and returns zero for a source with no standardize mapper, rather than throwing", async () => {
    const store = fakeStore({
      async loadRawSourceRecord() {
        return { recordSource: "find_that_charity", rawPayload: {} };
      },
    });
    const result = await detectAndFlagDiscrepancies("candidate-1", store);
    assert.equal(result.flagged, 0);
  });

  it("reports and returns zero when the raw payload fails to map, rather than throwing", async () => {
    const store = fakeStore({
      async loadRawSourceRecord() {
        return { recordSource: "companies_house", rawPayload: null };
      },
    });
    const result = await detectAndFlagDiscrepancies("candidate-1", store);
    assert.equal(result.flagged, 0);
  });

  it("returns zero when the entity match candidate no longer resolves to an organisation", async () => {
    const store = fakeStore({
      async loadEntityMatchCandidate() {
        return null;
      },
    });
    const result = await detectAndFlagDiscrepancies("candidate-1", store);
    assert.equal(result.flagged, 0);
  });
});
