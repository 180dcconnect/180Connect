import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RETURN_FIELDS,
  dateOnly,
  numberOrNull,
  pickNumber,
  postcodeAreaOf,
} from "./extract-rows.ts";

describe("postcodeAreaOf", () => {
  it("takes the letters before the first digit", () => {
    assert.equal(postcodeAreaOf("S1 2HE"), "S");
    assert.equal(postcodeAreaOf("sa1 1aa"), "SA");
    assert.equal(postcodeAreaOf("DN12 3XY"), "DN");
  });

  it("never lets a longer area collapse into a shorter one", () => {
    // The whole reason this is a parsed token and not a prefix: matching "S"
    // loosely would select roughly a tenth of the register.
    for (const [postcode, area] of [
      ["SA1 1AA", "SA"],
      ["SE1 1AA", "SE"],
      ["SK1 1AA", "SK"],
      ["SW1A 1AA", "SW"],
    ] as const) {
      assert.equal(postcodeAreaOf(postcode), area);
      assert.notEqual(postcodeAreaOf(postcode), "S");
    }
  });

  it("returns null when there is nothing to read", () => {
    assert.equal(postcodeAreaOf(null), null);
    assert.equal(postcodeAreaOf(undefined), null);
    assert.equal(postcodeAreaOf(""), null);
    assert.equal(postcodeAreaOf("Sheffield"), null);
  });
});

describe("dateOnly", () => {
  it("reduces the extracts' timestamps to a date", () => {
    assert.equal(dateOnly("2019-07-07T00:00:00"), "2019-07-07");
    assert.equal(dateOnly("2025-03-31"), "2025-03-31");
  });

  it("rejects anything that is not a date", () => {
    assert.equal(dateOnly(null), null);
    assert.equal(dateOnly(""), null);
    assert.equal(dateOnly("07/07/2019"), null);
    assert.equal(dateOnly(12345), null);
  });
});

describe("numberOrNull", () => {
  it("keeps zero, which is a real published figure", () => {
    assert.equal(numberOrNull(0), 0);
  });

  it("rejects anything that is not a finite number", () => {
    assert.equal(numberOrNull(null), null);
    assert.equal(numberOrNull("42"), null);
    assert.equal(numberOrNull(Number.NaN), null);
    assert.equal(numberOrNull(Number.POSITIVE_INFINITY), null);
  });
});

describe("RETURN_FIELDS", () => {
  it("prefers Part B's field and falls back to Part A's", () => {
    // Part B is the fuller return; Part A is what a smaller charity files.
    assert.deepEqual(RETURN_FIELDS.total_income, [
      "income_total_income_and_endowments",
      "total_gross_income",
    ]);
  });

  it("uses the register's own spellings", () => {
    // Both of these cost time when guessed: investments is plural, and the
    // government-funding fields exist only in Part A.
    assert.deepEqual(RETURN_FIELDS.income_investment, ["income_investments"]);
    assert.deepEqual(RETURN_FIELDS.income_govt_grants, ["income_from_government_grants"]);
    assert.deepEqual(RETURN_FIELDS.expenditure_charitable_activities, [
      "expenditure_charitable_expenditure",
    ]);
  });
});

describe("pickNumber", () => {
  const row = { organisation_number: 1, total_gross_income: 51_000 };

  it("falls through to the next candidate when the first is absent", () => {
    assert.equal(pickNumber(row, RETURN_FIELDS.total_income), 51_000);
  });

  it("prefers the first candidate when both are present", () => {
    assert.equal(
      pickNumber(
        { ...row, income_total_income_and_endowments: 52_500 },
        RETURN_FIELDS.total_income,
      ),
      52_500,
    );
  });

  it("returns null rather than zero when nothing is published", () => {
    // Null means "the register printed no figure". Zero would be a claim.
    assert.equal(pickNumber(row, RETURN_FIELDS.income_govt_grants), null);
  });
});
