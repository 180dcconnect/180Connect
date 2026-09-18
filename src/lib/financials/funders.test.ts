import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summariseFunders, type FunderGrantInput } from "./funders.ts";

const award = (
  funder: string | null,
  amount: number | null,
  date: string | null,
  currency: string | null = "GBP",
): FunderGrantInput => ({
  funder_name: funder,
  amount_awarded: amount,
  award_date: date,
  currency,
});

describe("summariseFunders", () => {
  it("returns the empty profile for no awards", () => {
    const profile = summariseFunders([]);
    assert.equal(profile.funderCount, 0);
    assert.equal(profile.total, 0);
    assert.equal(profile.topShare, null, "no money is not a zero share");
    assert.equal(profile.latest, null);
  });

  it("groups awards by funder and orders them largest first", () => {
    const profile = summariseFunders([
      award("Small Trust", 5_000, "2024-01-01"),
      award("Big Foundation", 60_000, "2024-02-01"),
      award("Big Foundation", 40_000, "2023-02-01"),
    ]);

    assert.equal(profile.funderCount, 2);
    assert.equal(profile.awardCount, 3);
    assert.equal(profile.total, 105_000);
    assert.deepEqual(
      profile.funders.map((funder) => funder.name),
      ["Big Foundation", "Small Trust"],
    );
    assert.equal(profile.funders[0].awards, 2);
  });

  it("reports the top funder's share of the money", () => {
    const profile = summariseFunders([
      award("A", 75_000, "2024-01-01"),
      award("B", 25_000, "2024-01-01"),
    ]);
    assert.equal(profile.topShare, 0.75);
  });

  it("gives a single funder the whole share rather than breaking the maths", () => {
    const profile = summariseFunders([award("Only Funder", 12_000, "2024-01-01")]);
    assert.equal(profile.funderCount, 1);
    assert.equal(profile.topShare, 1);
    assert.equal(profile.repeatFunders, 0);
  });

  it("counts a funder with two or more awards as a repeat funder", () => {
    const profile = summariseFunders([
      award("Repeat", 1_000, "2024-01-01"),
      award("Repeat", 1_000, "2023-01-01"),
      award("Once", 1_000, "2024-01-01"),
    ]);
    assert.equal(profile.repeatFunders, 1);
  });

  it("withholds the share when there is no money to apportion", () => {
    const profile = summariseFunders([
      award("Undisclosed Trust", null, "2024-01-01"),
      award("Another Trust", null, "2023-01-01"),
    ]);
    assert.equal(profile.funderCount, 2, "an unpriced award still evidences a funder");
    assert.equal(profile.awardCount, 2);
    assert.equal(profile.total, 0);
    assert.equal(profile.topShare, null, "a share of nothing is unknown, not zero");
  });

  it("excludes awards in another currency and says how many", () => {
    const profile = summariseFunders([
      award("Sterling Trust", 10_000, "2024-01-01"),
      award("US Foundation", 90_000, "2024-01-01", "USD"),
    ]);
    assert.equal(profile.funderCount, 1);
    assert.equal(profile.total, 10_000);
    assert.equal(profile.excludedCurrency, 1);
    assert.equal(profile.topShare, 1, "the share is of the money we could add up");
  });

  it("treats a missing currency as the accounts' own", () => {
    const profile = summariseFunders([award("Trust", 500, "2024-01-01", null)]);
    assert.equal(profile.total, 500);
    assert.equal(profile.excludedCurrency, 0);
  });

  it("drops awards with no usable funder name rather than inventing one", () => {
    const profile = summariseFunders([
      award("Named Trust", 1_000, "2024-01-01"),
      award("   ", 2_000, "2024-01-01"),
      award(null, 3_000, "2024-01-01"),
    ]);
    assert.equal(profile.funderCount, 1);
    assert.equal(profile.excludedUnnamed, 2);
    assert.equal(profile.total, 1_000);
  });

  it("finds the newest award by date, ignoring the input order", () => {
    const profile = summariseFunders([
      award("Older", 1_000, "2021-06-30"),
      award("Newest", 2_000, "2024-11-02"),
      award("Middle", 3_000, "2023-01-01"),
    ]);
    assert.equal(profile.latest?.name, "Newest");
    assert.equal(profile.latest?.awardDate, "2024-11-02");
    assert.equal(profile.latest?.amount, 2_000);
  });

  it("ignores awards with no date when picking the newest", () => {
    const profile = summariseFunders([
      award("Dated", 1_000, "2020-01-01"),
      award("Undated", 9_000, null),
    ]);
    assert.equal(profile.latest?.name, "Dated");
  });

  it("carries a null amount on the newest award rather than reporting zero", () => {
    const profile = summariseFunders([award("Trust", null, "2024-05-05")]);
    assert.equal(profile.latest?.amount, null);
  });

  it("normalises a lowercase currency code", () => {
    const profile = summariseFunders([award("Trust", 400, "2024-01-01", "gbp")]);
    assert.equal(profile.total, 400);
    assert.equal(profile.excludedCurrency, 0);
  });

  it("orders two equally funded funders by award count, then name", () => {
    const profile = summariseFunders([
      award("Zebra Trust", 5_000, "2024-01-01"),
      award("Apple Trust", 2_500, "2024-01-01"),
      award("Apple Trust", 2_500, "2023-01-01"),
    ]);
    assert.deepEqual(
      profile.funders.map((funder) => funder.name),
      ["Apple Trust", "Zebra Trust"],
    );
  });
});
