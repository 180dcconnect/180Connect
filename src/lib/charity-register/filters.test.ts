import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeFilters,
  isUnfiltered,
  normalisePostcodeArea,
  parseFilters,
} from "./filters.ts";

describe("parseFilters — empty means everything", () => {
  it("treats no input as no restriction", () => {
    assert.equal(isUnfiltered(parseFilters(undefined)), true);
    assert.equal(isUnfiltered(parseFilters({})), true);
    assert.equal(isUnfiltered(parseFilters(null)), true);
  });

  it("treats an empty classification list as 'any', not 'none'", () => {
    // The bug the old whitelist could not express: there was no way to say
    // "every sector", because the list *was* the filter.
    const f = parseFilters({ classifications: { what: [] } });
    assert.deepEqual(f.classifications?.what, []);
    assert.equal(isUnfiltered(f), true);
  });

  it("drops blank and duplicate entries rather than filtering on them", () => {
    const f = parseFilters({
      classifications: { what: ["Disability", " Disability ", "", "   "] },
    });
    assert.deepEqual(f.classifications?.what, ["Disability"]);
  });
});

describe("parseFilters — income", () => {
  it("includes charities with no published income by default", () => {
    // 238 of the branch's 4,340 local charities publish no figure. Reading that
    // as "small" is what excluded them from every import.
    assert.equal(parseFilters({ incomeMin: 1000 }).includeUnpublishedIncome, true);
  });

  it("only excludes them on an explicit false", () => {
    assert.equal(
      parseFilters({ incomeMin: 1000, includeUnpublishedIncome: false })
        .includeUnpublishedIncome,
      false,
    );
    // A preset saved before the switch existed keeps the inclusive behaviour.
    assert.equal(
      parseFilters({ incomeMin: 1000, includeUnpublishedIncome: undefined })
        .includeUnpublishedIncome,
      true,
    );
  });

  it("swaps bounds that arrive the wrong way round", () => {
    const f = parseFilters({ incomeMin: 500_000, incomeMax: 10_000 });
    assert.equal(f.incomeMin, 10_000);
    assert.equal(f.incomeMax, 500_000);
  });

  it("drops unusable bounds instead of failing the whole filter", () => {
    const f = parseFilters({ incomeMin: "lots", incomeMax: -5, nameContains: "trust" });
    assert.equal(f.incomeMin, null);
    assert.equal(f.incomeMax, null);
    assert.equal(f.nameContains, "trust");
  });

  it("keeps a zero floor, which is not the same as no floor", () => {
    assert.equal(parseFilters({ incomeMin: 0 }).incomeMin, 0);
  });
});

describe("parseFilters — dates", () => {
  it("accepts YYYY-MM-DD and rejects anything else", () => {
    assert.equal(parseFilters({ registeredFrom: "2026-01-01" }).registeredFrom, "2026-01-01");
    assert.equal(parseFilters({ registeredFrom: "01/01/2026" }).registeredFrom, null);
  });

  it("swaps a reversed range", () => {
    const f = parseFilters({ registeredFrom: "2026-06-01", registeredTo: "2026-01-01" });
    assert.equal(f.registeredFrom, "2026-01-01");
    assert.equal(f.registeredTo, "2026-06-01");
  });
});

describe("normalisePostcodeArea", () => {
  it("takes the letters before the first digit", () => {
    assert.equal(normalisePostcodeArea("S1 2HE"), "S");
    assert.equal(normalisePostcodeArea("sa1 1aa"), "SA");
    assert.equal(normalisePostcodeArea("DN1"), "DN");
  });

  it("accepts a bare area someone typed", () => {
    assert.equal(normalisePostcodeArea("s"), "S");
    assert.equal(normalisePostcodeArea(" dn "), "DN");
  });

  it("returns empty for anything it cannot read", () => {
    assert.equal(normalisePostcodeArea(""), "");
    assert.equal(normalisePostcodeArea("12345"), "");
    assert.equal(normalisePostcodeArea("Sheffield"), "");
  });

  it("never confuses S with SA, SE, SK or SW", () => {
    // Matching "S" as a prefix would swallow about a tenth of the register.
    for (const other of ["SA1 1AA", "SE1 1AA", "SK1 1AA", "SW1A 1AA"]) {
      assert.notEqual(normalisePostcodeArea(other), "S");
    }
  });
});

describe("describeFilters", () => {
  it("says so plainly when nothing is filtered", () => {
    assert.equal(
      describeFilters({}),
      "Every registered charity in England and Wales.",
    );
  });

  it("writes an income range in pounds", () => {
    assert.match(describeFilters({ incomeMin: 10_000, incomeMax: 500_000 }), /£10,000–£500,000/);
    assert.match(describeFilters({ incomeMin: 10_000 }), /at least £10,000/);
    assert.match(describeFilters({ incomeMax: 50_000 }), /up to £50,000/);
  });

  it("mentions excluded unpublished income only when it is excluded and relevant", () => {
    assert.match(
      describeFilters({ incomeMin: 1000, includeUnpublishedIncome: false }),
      /excluding charities with no published income/,
    );
    // No bound to exclude them from, so there is nothing to say.
    assert.doesNotMatch(
      describeFilters({ includeUnpublishedIncome: false, nameContains: "trust" }),
      /no published income/,
    );
  });

  it("joins the location clauses with or by default, and with and when asked", () => {
    const filters = {
      postcodeAreas: ["S", "DN"],
      areas: { localAuthority: ["Sheffield City"] },
    };
    assert.match(describeFilters(filters), /S or DN postcodes or operating in Sheffield City/);
    assert.match(
      describeFilters({ ...filters, locationMatch: "all" as const }),
      /postcodes and operating in Sheffield City/,
    );
  });

  it("names all three classification dimensions", () => {
    const sentence = describeFilters({
      classifications: {
        what: ["Arts/culture/heritage/science"],
        who: ["Children/young People"],
        how: ["Provides Services"],
      },
    });
    // The first clause is sentence-capitalised, hence the case-insensitive match.
    assert.match(sentence, /doing Arts\/culture\/heritage\/science/i);
    assert.match(sentence, /helping Children\/young People/);
    assert.match(sentence, /working by Provides Services/);
  });

  it("reads as one sentence for a realistic preset", () => {
    assert.equal(
      describeFilters({
        incomeMax: 50_000,
        postcodeAreas: ["S"],
        areas: { localAuthority: ["Sheffield City"] },
        classifications: { what: ["Arts/culture/heritage/science"] },
      }),
      "Income up to £50,000; S postcodes or operating in Sheffield City; " +
        "doing Arts/culture/heritage/science.",
    );
  });
});
