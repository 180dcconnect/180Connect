import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCompleteness,
  type CompletenessInput,
  type CompletenessKey,
} from "./client-completeness.ts";

const empty: CompletenessInput = {
  identifierCount: 0,
  filingCount: 0,
  headcountFilingCount: 0,
  grantCount: 0,
};

const full: CompletenessInput = {
  identifierCount: 2,
  filingCount: 3,
  headcountFilingCount: 2,
  grantCount: 5,
};

function keysPresent(input: CompletenessInput): CompletenessKey[] {
  return buildCompleteness(input)
    .items.filter((item) => item.present)
    .map((item) => item.key);
}

describe("buildCompleteness", () => {
  it("returns the same four signals in the same order whatever the state", () => {
    const order = buildCompleteness(empty).items.map((item) => item.key);
    assert.deepEqual(order, ["registration", "accounts", "headcount", "grants"]);
    assert.deepEqual(buildCompleteness(full).items.map((item) => item.key), order);
  });

  it("counts nothing on an empty record", () => {
    const result = buildCompleteness(empty);
    assert.equal(result.present, 0);
    assert.equal(result.total, 4);
    assert.equal(result.items.every((item) => !item.present), true);
  });

  it("counts everything on a complete record", () => {
    const result = buildCompleteness(full);
    assert.equal(result.present, 4);
    assert.equal(result.total, 4);
  });

  it("lights a signal on a single row", () => {
    assert.deepEqual(
      keysPresent({ identifierCount: 1, filingCount: 1, headcountFilingCount: 1, grantCount: 1 }),
      ["registration", "accounts", "headcount", "grants"],
    );
  });

  it("keeps the signals independent", () => {
    assert.deepEqual(keysPresent({ ...empty, identifierCount: 1 }), ["registration"]);
    assert.deepEqual(keysPresent({ ...empty, grantCount: 1 }), ["grants"]);
  });

  it("leaves headcount dark when accounts are filed without staff numbers", () => {
    const result = buildCompleteness({ ...empty, filingCount: 4 });
    assert.deepEqual(keysPresent({ ...empty, filingCount: 4 }), ["accounts"]);
    const headcount = result.items.find((item) => item.key === "headcount");
    assert.match(headcount?.detail ?? "", /^No staff numbers filed/);
  });

  it("says what is held when present and what is absent when missing", () => {
    const held = buildCompleteness(full).items.find((item) => item.key === "accounts");
    assert.equal(held?.detail, "3 filed periods of accounts");

    const one = buildCompleteness({ ...empty, filingCount: 1 }).items.find(
      (item) => item.key === "accounts",
    );
    assert.equal(one?.detail, "1 filed period of accounts");

    const missing = buildCompleteness(empty).items.find((item) => item.key === "accounts");
    assert.match(missing?.detail ?? "", /^No filed accounts/);
  });

  it("singularises the headcount and registration wording too", () => {
    const items = buildCompleteness({
      ...empty,
      identifierCount: 1,
      headcountFilingCount: 1,
    }).items;
    assert.equal(
      items.find((item) => item.key === "registration")?.detail,
      "1 registration number on file",
    );
    assert.equal(
      items.find((item) => item.key === "headcount")?.detail,
      "Staff numbers stated in 1 filed period",
    );
  });

  it("keeps labels stable regardless of state", () => {
    assert.deepEqual(
      buildCompleteness(empty).items.map((item) => item.label),
      buildCompleteness(full).items.map((item) => item.label),
    );
  });
});
