import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normaliseRegistrationNumber, registerIdForName } from "./registration-number.ts";

describe("registerIdForName", () => {
  it("maps the stored names back to their option", () => {
    assert.equal(registerIdForName("Charity Commission for England and Wales"), "ccew");
    assert.equal(registerIdForName("Companies House"), "companies_house");
    assert.equal(registerIdForName("Scottish Charity Regulator"), "oscr");
    assert.equal(registerIdForName("Charity Commission for Northern Ireland"), "ccni");
  });

  it("recognises the loose spellings older drafts carry", () => {
    assert.equal(registerIdForName("charity commission"), "ccew");
    assert.equal(registerIdForName("CCEW"), "ccew");
    assert.equal(registerIdForName("OSCR"), "oscr");
  });

  it("treats anything else as another register, and nothing as nothing", () => {
    assert.equal(registerIdForName("FCA Mutuals Register"), "other");
    assert.equal(registerIdForName("  "), null);
    assert.equal(registerIdForName(null), null);
  });
});

describe("normaliseRegistrationNumber", () => {
  it("accepts 6 or 7 digit charity numbers and rejects the rest", () => {
    assert.deepEqual(normaliseRegistrationNumber("ccew", "1012 345"), { ok: true, value: "1012345" });
    assert.equal(normaliseRegistrationNumber("ccew", "12345").ok, false);
    assert.equal(normaliseRegistrationNumber("ccew", "SC012345").ok, false);
  });

  it("zero-pads company numbers and accepts prefixed ones", () => {
    assert.deepEqual(normaliseRegistrationNumber("companies_house", "1234567"), {
      ok: true,
      value: "01234567",
    });
    assert.deepEqual(normaliseRegistrationNumber("companies_house", "sc123456"), {
      ok: true,
      value: "SC123456",
    });
    assert.equal(normaliseRegistrationNumber("companies_house", "123456789").ok, false);
  });

  it("canonicalises Scottish and Northern Irish numbers", () => {
    assert.deepEqual(normaliseRegistrationNumber("oscr", "sc 012345"), { ok: true, value: "SC012345" });
    assert.deepEqual(normaliseRegistrationNumber("ccni", "100002"), { ok: true, value: "NIC100002" });
    assert.equal(normaliseRegistrationNumber("oscr", "012345").ok, false);
  });

  it("leaves another register's number as typed, but not empty", () => {
    assert.deepEqual(normaliseRegistrationNumber("other", " RS-00123 "), { ok: true, value: "RS-00123" });
    assert.equal(normaliseRegistrationNumber("other", "  ").ok, false);
  });
});
