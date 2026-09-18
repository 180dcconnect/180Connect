import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRegisterRecord, type RegisterRecordInput } from "./register-record.ts";

/**
 * F042's review screen shows an admin the incoming register record beside the
 * client record it looks like. This is the left-hand column, and it was the
 * column that was empty: every bulk register record was read with a top-level
 * `charity_name`, which is null on all of them because the extract nests the
 * charity under `charity`. The first test below is that bug.
 */
function input(overrides: Partial<RegisterRecordInput> = {}): RegisterRecordInput {
  return {
    rawPayload: null,
    recordSource: "charity_commission_bulk",
    sourceRecordId: null,
    ...overrides,
  };
}

/** One row of the Charity Commission's bulk register extract, as stored. */
function bulkPayload(charity: Record<string, unknown> = {}): unknown {
  return {
    charity: {
      organisation_number: 500001,
      registered_charity_number: 1000001,
      charity_name: "SHEFFIELD EXAMPLE TRUST",
      charity_contact_address1: "12 High Street",
      charity_contact_address2: "Ecclesall",
      charity_contact_address5: "SHEFFIELD",
      charity_contact_postcode: "S1 2HE",
      charity_contact_web: "example.org",
      charity_contact_email: "info@example.org",
      latest_income: 900_000,
      ...charity,
    },
    annual_returns: [{ ar_cycle_reference: "AR24" }],
  };
}

describe("readRegisterRecord — the bulk register extract", () => {
  it("reads the name nested under `charity`, not the top level", () => {
    const facts = readRegisterRecord(input({ rawPayload: bulkPayload() }));
    assert.equal(facts.name, "SHEFFIELD EXAMPLE TRUST");
  });

  it("reads both registry numbers, tagged with the register they came from", () => {
    const facts = readRegisterRecord(
      input({
        rawPayload: bulkPayload({ charity_company_registration_number: "01336352" }),
      }),
    );

    assert.deepEqual(facts.numbers, [
      { type: "uk_charity", value: "1000001" },
      { type: "uk_company", value: "01336352" },
    ]);
  });

  it("reads the address the way the mapper stores it: first line is the street", () => {
    const facts = readRegisterRecord(input({ rawPayload: bulkPayload() }));
    assert.equal(facts.address, "12 High Street");
    assert.equal(facts.postcode, "S1 2HE");
  });

  it("reads the register's published website and latest filed income", () => {
    const facts = readRegisterRecord(input({ rawPayload: bulkPayload() }));
    assert.equal(facts.website, "example.org");
    assert.equal(facts.income, 900_000);
  });

  it("reads income published as a string, figures and separators included", () => {
    const facts = readRegisterRecord(
      input({ rawPayload: bulkPayload({ latest_income: "1,250,000" }) }),
    );
    assert.equal(facts.income, 1_250_000);
  });
});

describe("readRegisterRecord — the Charity Commission's live API", () => {
  it("reads the flat payload the API publishes", () => {
    const facts = readRegisterRecord(
      input({
        recordSource: "charity_commission",
        rawPayload: {
          charity_name: "ARTS ELSEWHERE",
          reg_charity_number: 5254841,
          address_line_one: "1 High Street",
          address_line_five: "SHEFFIELD",
          address_post_code: "S3 8AA",
          web: "arts-elsewhere.org",
          email: "hello@arts-elsewhere.org",
          latest_income: 250_000,
        },
      }),
    );

    assert.equal(facts.name, "ARTS ELSEWHERE");
    assert.deepEqual(facts.numbers, [{ type: "uk_charity", value: "5254841" }]);
    assert.equal(facts.address, "1 High Street");
    assert.equal(facts.postcode, "S3 8AA");
    assert.equal(facts.website, "arts-elsewhere.org");
    assert.equal(facts.income, 250_000);
  });
});

describe("readRegisterRecord — Companies House", () => {
  it("reads the company number and the registered office address", () => {
    const facts = readRegisterRecord(
      input({
        recordSource: "companies_house",
        sourceRecordId: "01336352",
        rawPayload: {
          company_name: "ACME SERVICES LTD",
          company_number: "01336352",
          registered_office_address: {
            address_line_1: "1 High Street",
            locality: "Bristol",
            postal_code: "BS5 0HE",
          },
        },
      }),
    );

    assert.equal(facts.name, "ACME SERVICES LTD");
    assert.deepEqual(facts.numbers, [{ type: "uk_company", value: "01336352" }]);
    assert.equal(facts.address, "1 High Street");
    assert.equal(facts.postcode, "BS5 0HE");
    assert.equal(facts.website, null);
    assert.equal(facts.income, null);
  });

  it("falls back to the stored record id when the payload carries no company number", () => {
    const facts = readRegisterRecord(
      input({
        recordSource: "companies_house",
        sourceRecordId: "01336352",
        rawPayload: { company_name: "ACME SERVICES LTD" },
      }),
    );

    assert.deepEqual(facts.numbers, [{ type: "uk_company", value: "01336352" }]);
  });
});

describe("readRegisterRecord — Find That Charity", () => {
  it("reads the name the mapper stores, not the decorated label", () => {
    const facts = readRegisterRecord(
      input({
        recordSource: "find_that_charity",
        rawPayload: {
          queried_name: "Oxfam",
          name: "Oxfam (GB-CHC-202918) [INACTIVE]",
          id: "GB-CHC-202918",
        },
      }),
    );

    assert.equal(facts.name, "Oxfam");
    assert.deepEqual(facts.numbers, [{ type: "uk_charity", value: "202918" }]);
  });

  it("claims no number for a register that is not the Charity Commission's", () => {
    const facts = readRegisterRecord(
      input({
        recordSource: "find_that_charity",
        rawPayload: { queried_name: "Belfast Trust", id: "GB-NIC-100012" },
      }),
    );

    assert.deepEqual(facts.numbers, []);
  });
});

describe("readRegisterRecord — resilience and policy", () => {
  it("returns an empty record rather than throwing on a payload it cannot read", () => {
    for (const rawPayload of [null, "not an object", 42, [], { charity: null }, {}]) {
      const facts = readRegisterRecord(input({ rawPayload }));
      assert.deepEqual(facts, {
        name: null,
        numbers: [],
        postcode: null,
        address: null,
        website: null,
        income: null,
      });
    }
  });

  it("never reads contact email or phone, which the payloads carry and policy redacts", () => {
    const facts = readRegisterRecord(input({ rawPayload: bulkPayload() }));
    assert.deepEqual(Object.keys(facts).sort(), [
      "address",
      "income",
      "name",
      "numbers",
      "postcode",
      "website",
    ]);
  });
});
