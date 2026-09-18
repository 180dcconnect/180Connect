import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  companyIdentifierRowsFor,
  companyNumberTargetsFor,
  type CompanyNumberTarget,
} from "./company-number-backfill.ts";

/** A register lookup answering for the charities named in `companyNumbers`. */
function registerHolding(
  companyNumbers: Readonly<Record<string, string | null>>,
): { lookup: (registeredNumber: number) => { companyNumber?: string | null } | null; asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    lookup: (registeredNumber) => {
      asked.push(registeredNumber);
      const value = companyNumbers[String(registeredNumber)];
      return value === undefined ? null : { companyNumber: value };
    },
  };
}

function identifier(organisationId: string, value: string) {
  return { organisation_id: organisationId, identifier_value: value };
}

describe("companyNumberTargetsFor", () => {
  it("targets a charity the register publishes a second number for", () => {
    const { lookup } = registerHolding({ "1012345": "01336352" });
    const targets = companyNumberTargetsFor({
      charityNumbers: [identifier("org-1", "1012345")],
      holders: new Set(),
      lookup,
    });

    assert.deepEqual(targets, [
      { organisationId: "org-1", charityNumber: "1012345", companyNumber: "01336352" },
    ]);
  });

  it("leaves a client that already holds a company number alone", () => {
    // Someone's answer — the register's own, from an import, or a correction. A
    // backfill restating it is how two writers start fighting over one column,
    // and this is also what keeps a second press from inserting a duplicate.
    const { lookup, asked } = registerHolding({ "1012345": "01336352" });
    const targets = companyNumberTargetsFor({
      charityNumbers: [identifier("org-1", "1012345")],
      holders: new Set(["org-1"]),
      lookup,
    });

    assert.deepEqual(targets, []);
    assert.deepEqual(asked, [], "read the register for an organisation already holding one");
  });

  it("says nothing for a charity that is not also a company", () => {
    const { lookup } = registerHolding({ "1012345": null });
    assert.deepEqual(
      companyNumberTargetsFor({
        charityNumbers: [identifier("org-1", "1012345")],
        holders: new Set(),
        lookup,
      }),
      [],
    );
  });

  it("says nothing for a charity the register file does not hold", () => {
    const { lookup } = registerHolding({});
    assert.deepEqual(
      companyNumberTargetsFor({
        charityNumbers: [identifier("org-1", "1012345")],
        holders: new Set(),
        lookup,
      }),
      [],
    );
  });

  it("never looks up a value that cannot be a charity number", () => {
    // A prefixed number (the Scottish register) and an eight-digit one (a company
    // number) are not questions the charity file can answer, and asking it anyway
    // is how one organisation's company number ends up on another one's record.
    const { lookup, asked } = registerHolding({ "1012345": "01336352" });
    const targets = companyNumberTargetsFor({
      charityNumbers: [identifier("org-1", "SC012345"), identifier("org-2", "12345678")],
      holders: new Set(),
      lookup,
    });

    assert.deepEqual(targets, []);
    assert.deepEqual(asked, []);
  });

  it("writes one target per organisation, not per identifier", () => {
    const { lookup } = registerHolding({ "1012345": "01336352" });
    const targets = companyNumberTargetsFor({
      charityNumbers: [identifier("org-1", "1012345"), identifier("org-1", "1012345")],
      holders: new Set(),
      lookup,
    });

    assert.equal(targets.length, 1);
  });

  it("ignores rows with no organisation or no number", () => {
    const { lookup, asked } = registerHolding({ "1012345": "01336352" });
    const targets = companyNumberTargetsFor({
      charityNumbers: [identifier("", "1012345"), identifier("org-1", "   ")],
      holders: new Set(),
      lookup,
    });

    assert.deepEqual(targets, []);
    assert.deepEqual(asked, []);
  });

  it("narrows to the organisations it was given", () => {
    const { lookup } = registerHolding({ "1012345": "01336352", "1012346": "01336353" });
    const targets = companyNumberTargetsFor({
      charityNumbers: [identifier("org-1", "1012345"), identifier("org-2", "1012346")],
      holders: new Set(),
      lookup,
      only: new Set(["org-2"]),
    });

    assert.deepEqual(
      targets.map((target) => target.organisationId),
      ["org-2"],
    );
  });
});

describe("companyIdentifierRowsFor", () => {
  const target: CompanyNumberTarget = {
    organisationId: "org-1",
    charityNumber: "1012345",
    companyNumber: "01336352",
  };

  it("files the number as a second, unverified company identifier", () => {
    assert.deepEqual(companyIdentifierRowsFor([target]), [
      {
        organisation_id: "org-1",
        identifier_type: "uk_company",
        identifier_value: "01336352",
        registry_name: "Companies House",
        registry_country: "GB",
        // Not primary: the charity number is what this record was created and
        // deduplicated by, and one-primary-per-organisation is a partial unique
        // index — a second true would be rejected by the database.
        is_primary: false,
        // Read out of the register, not confirmed against it.
        verified: false,
      },
    ]);
  });

  it("writes nothing for nothing", () => {
    assert.deepEqual(companyIdentifierRowsFor([]), []);
  });
});
