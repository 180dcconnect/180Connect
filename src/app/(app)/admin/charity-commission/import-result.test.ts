import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunSummary } from "@/lib/ingestion/type";
import type { PromoteCounts } from "@/lib/standardize/write-organisations";
import {
  importStateFromSummary,
  describePromotion,
  lookupOutcome,
  type ListedCharity,
} from "./import-result.ts";

function summary(status: RunSummary["status"], error?: string): RunSummary {
  return {
    source: "charity_commission",
    status,
    counts: { fetched: 5, inserted: 2, skipped: 2, failed: 1 },
    written: { new: 1, changed: 1 },
    runId: "11111111-1111-1111-1111-111111111111",
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
    flagged: 0,
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

// The single-charity answer, which the batch counters cannot give on their own.
describe("lookupOutcome", () => {
  const listed: ListedCharity = {
    organisationId: "org-1",
    name: "Sheffield Example Trust",
    grants: { status: "queued" },
  };

  it("reports a charity that was not on the list before as added", () => {
    const outcome = lookupOutcome(null, listed, { inserted: 1, needsReview: 0, doesNotMeet: 0, invalidData: 0, failed: 0 });
    assert.deepEqual(outcome, { kind: "added", ...listed });
  });

  // The case the old counts grid could not express: the raw record dedups on
  // checksum and promotion flags it as a duplicate, so every counter the dialog
  // rendered was zero while the charity sat on the list all along.
  it("reports a charity that was already there as already listed, not as nothing happening", () => {
    const outcome = lookupOutcome(listed, listed, { inserted: 0, needsReview: 0, doesNotMeet: 0, invalidData: 0, failed: 0 });
    assert.deepEqual(outcome, { kind: "already_listed", ...listed });
  });

  it("carries the grant coverage of the record as it stands after the run", () => {
    const withGrants: ListedCharity = { ...listed, grants: { status: "fetched", count: 12 } };
    const outcome = lookupOutcome(null, withGrants, { inserted: 1, needsReview: 0, doesNotMeet: 0, invalidData: 0, failed: 0 });
    assert.deepEqual(outcome.kind === "added" ? outcome.grants : null, { status: "fetched", count: 12 });
  });

  it("distinguishes held-for-review from rejected when nothing reached the list", () => {
    assert.equal(
      lookupOutcome(null, null, { inserted: 0, needsReview: 1, doesNotMeet: 0, invalidData: 0, failed: 0 }).kind,
      "held_for_review",
    );
    assert.equal(
      lookupOutcome(null, null, { inserted: 0, needsReview: 0, doesNotMeet: 1, invalidData: 0, failed: 0 }).kind,
      "does_not_meet",
    );
  });

  it("falls back to not-on-list when the counters explain nothing", () => {
    assert.equal(lookupOutcome(null, null, undefined).kind, "not_on_list");
    assert.equal(
      lookupOutcome(null, null, { inserted: 0, needsReview: 0, doesNotMeet: 0, invalidData: 1, failed: 0 }).kind,
      "not_on_list",
    );
  });

  // Presence wins over the counters: a review flag on some other record in the
  // same promote pass must not hide a charity that is demonstrably on the list.
  it("prefers what is actually on the list over what the counters say", () => {
    const outcome = lookupOutcome(null, listed, { inserted: 0, needsReview: 1, doesNotMeet: 0, invalidData: 0, failed: 0 });
    assert.equal(outcome.kind, "added");
  });
});
