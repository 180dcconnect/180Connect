import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunSummary } from "@/lib/ingestion/type";
import type { PromoteCounts } from "@/lib/standardize/write-organisations";
import { importStateFromSummary, describePromotion } from "./import-result.ts";

function summary(status: RunSummary["status"], error?: string): RunSummary {
  return {
    source: "charity_commission",
    status,
    counts: { fetched: 5, inserted: 2, skipped: 2, failed: 1 },
    written: { new: 1, changed: 1 },
    error: status === "failed" ? (error ?? "secret upstream detail") : undefined,
  };
}

describe("importStateFromSummary", () => {
  it("shows successful import counts", () => {
    const state = importStateFromSummary(summary("completed"));
    assert.equal(state.kind, "success");
    assert.deepEqual(state.counts, {
      fetched: 5,
      written: 2,
      skipped: 2,
      failed: 1,
    });
  });

  it("makes partial imports visible as warnings", () => {
    assert.equal(importStateFromSummary(summary("partial")).kind, "warning");
  });

  it("does not expose upstream failure details", () => {
    const state = importStateFromSummary(summary("failed"));
    assert.equal(state.kind, "error");
    assert.doesNotMatch(state.message, /secret upstream detail/);
  });

  it("shows safe lookup failures so the admin can correct the input", () => {
    const message = "Charity Commission could not find a charity with that registration number.";
    assert.equal(importStateFromSummary(summary("failed", message)).message, message);
  });
});

function promoteCounts(overrides: Partial<PromoteCounts> = {}): PromoteCounts {
  return {
    read: 0,
    inserted: 0,
    rejected: 0,
    invalidData: 0,
    needsReview: 0,
    doesNotMeet: 0,
    failed: 0,
    ...overrides,
  };
}

describe("describePromotion", () => {
  it("says nothing was waiting when there was nothing to promote", () => {
    assert.equal(
      describePromotion(promoteCounts({ read: 0 })),
      "Nothing was waiting to be added to the client list.",
    );
  });

  it("reports an insert", () => {
    assert.equal(
      describePromotion(promoteCounts({ read: 1, inserted: 1 })),
      "1 added to the client list.",
    );
  });

  it("combines every non-zero bucket into one sentence", () => {
    const message = describePromotion(
      promoteCounts({ read: 5, inserted: 1, needsReview: 2, doesNotMeet: 1, invalidData: 1 }),
    );
    assert.equal(
      message,
      "1 added to the client list, 2 flagged for review, 1 did not meet the client criteria, 1 had no usable name.",
    );
  });
});
