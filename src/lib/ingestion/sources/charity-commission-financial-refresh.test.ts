import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { needsHistory } from "./charity-commission-financial-refresh.ts";

const latest = (periodEnd: string | null) => ({
  registeredNumber: "1",
  periodStart: null,
  periodEnd,
  totalIncome: 1,
  totalExpenditure: 1,
  registeredOn: "2010-01-01",
  reportingStatus: "Submission Received",
});

describe("needsHistory", () => {
  it("re-fetches a complete charity with no stored breakdown only when asked", () => {
    const target = {
      storedLatestEnd: "2025-03-31",
      storedCount: 5,
      storedHasBreakdown: false,
    };

    assert.equal(needsHistory(target, latest("2025-03-31")), false);
    assert.equal(
      needsHistory(target, latest("2025-03-31"), { includeMissingBreakdown: true }),
      true,
    );
  });

  it("leaves a charity alone once its breakdown is stored", () => {
    assert.equal(
      needsHistory(
        { storedLatestEnd: "2025-03-31", storedCount: 5, storedHasBreakdown: true },
        latest("2025-03-31"),
        { includeMissingBreakdown: true },
      ),
      false,
    );
  });

  it("spends nothing on a charity that has never filed", () => {
    assert.equal(
      needsHistory({ storedLatestEnd: null, storedCount: 0, storedHasBreakdown: false }, latest(null)),
      false,
    );
  });

  it("spends nothing when the register answered with no charity at all", () => {
    assert.equal(
      needsHistory({ storedLatestEnd: null, storedCount: 0, storedHasBreakdown: false }, undefined),
      false,
    );
  });

  it("fetches history when we hold nothing and the register has a filing", () => {
    assert.equal(
      needsHistory({ storedLatestEnd: null, storedCount: 0, storedHasBreakdown: false }, latest("2025-03-31")),
      true,
    );
  });

  it("fetches history for a single stored period — the old promote path's signature", () => {
    assert.equal(
      needsHistory(
        { storedLatestEnd: "2025-03-31", storedCount: 1, storedHasBreakdown: false },
        latest("2025-03-31"),
      ),
      true,
    );
  });

  it("fetches history when the register has moved on to a newer year", () => {
    assert.equal(
      needsHistory(
        { storedLatestEnd: "2024-03-31", storedCount: 5, storedHasBreakdown: true },
        latest("2025-03-31"),
      ),
      true,
    );
  });

  it("spends nothing when what we hold is already current", () => {
    assert.equal(
      needsHistory(
        { storedLatestEnd: "2025-03-31", storedCount: 5, storedHasBreakdown: true },
        latest("2025-03-31"),
      ),
      false,
    );
  });

  it("spends nothing when our newest year is somehow ahead of the register's", () => {
    assert.equal(
      needsHistory(
        { storedLatestEnd: "2025-03-31", storedCount: 5, storedHasBreakdown: true },
        latest("2024-03-31"),
      ),
      false,
    );
  });
});
