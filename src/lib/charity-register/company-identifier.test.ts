import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { companyNumberForRegisteredCharity, type CharityCompanyLookup } from "./company-identifier.ts";

/** A lookup that records what it was asked, so "did not read the file" is testable. */
function spyLookup(
  answer: ReturnType<CharityCompanyLookup>,
): { lookup: CharityCompanyLookup; asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    lookup: (registeredNumber) => {
      asked.push(registeredNumber);
      return answer;
    },
  };
}

describe("companyNumberForRegisteredCharity", () => {
  it("returns the register's company number in the app's canonical form", () => {
    const { lookup, asked } = spyLookup({ companyNumber: "01336352" });
    assert.equal(companyNumberForRegisteredCharity("ccew", "1012345", lookup), "01336352");
    assert.deepEqual(asked, [1012345]);
  });

  it("zero-pads a company number the register prints short", () => {
    // The registers print and accept company numbers differently; every
    // identifier in the app is stored padded, so this must match.
    const { lookup } = spyLookup({ companyNumber: "1234567" });
    assert.equal(companyNumberForRegisteredCharity("ccew", "1012345", lookup), "01234567");
  });

  it("keeps a prefixed company number as the register prints it", () => {
    const { lookup } = spyLookup({ companyNumber: "SC123456" });
    assert.equal(companyNumberForRegisteredCharity("ccew", "1012345", lookup), "SC123456");
  });

  it("accepts the charity number as a number as well as a string", () => {
    const { lookup, asked } = spyLookup({ companyNumber: "01336352" });
    assert.equal(companyNumberForRegisteredCharity("ccew", 1012345, lookup), "01336352");
    assert.deepEqual(asked, [1012345]);
  });

  it("says nothing for a charity the register knows has no company number", () => {
    const { lookup } = spyLookup({ companyNumber: null });
    assert.equal(companyNumberForRegisteredCharity("ccew", "1012345", lookup), null);
  });

  it("says nothing for a charity the file does not hold", () => {
    const { lookup } = spyLookup(null);
    assert.equal(companyNumberForRegisteredCharity("ccew", "1012345", lookup), null);
  });

  it("does not read the charity file for another register", () => {
    // A six-digit number against Companies House is a company number. Looking it
    // up as a charity number would return a different organisation's company
    // number, which is worse than knowing nothing.
    for (const register of ["companies_house", "oscr", "ccni", "other", null] as const) {
      const { lookup, asked } = spyLookup({ companyNumber: "01336352" });
      assert.equal(companyNumberForRegisteredCharity(register, "01234567", lookup), null);
      assert.deepEqual(asked, [], `read the charity file for ${String(register)}`);
    }
  });

  it("does not read the charity file for something that is not a charity number", () => {
    const { lookup, asked } = spyLookup({ companyNumber: "01336352" });
    assert.equal(companyNumberForRegisteredCharity("ccew", "12345", lookup), null);
    assert.equal(companyNumberForRegisteredCharity("ccew", "", lookup), null);
    assert.equal(companyNumberForRegisteredCharity("ccew", null, lookup), null);
    assert.equal(companyNumberForRegisteredCharity("ccew", "SC012345", lookup), null);
    assert.deepEqual(asked, []);
  });

  it("says nothing when the file holds something that is not a company number", () => {
    // Defensive: the column is free text in the register file, and a value that
    // cannot be a company number must never reach the identifier or the record's
    // CHECK constraint.
    const { lookup } = spyLookup({ companyNumber: "not a number" });
    assert.equal(companyNumberForRegisteredCharity("ccew", "1012345", lookup), null);
  });
});
