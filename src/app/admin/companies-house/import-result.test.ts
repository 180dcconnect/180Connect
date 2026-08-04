import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunSummary } from "@/lib/ingestion/type";
import { importStateFromSummary } from "./import-result.ts";

function summary(status: RunSummary["status"], error?: string): RunSummary {
  return {
    source: "companies_house",
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
    const message = "Companies House could not find that company number.";
    assert.equal(importStateFromSummary(summary("failed", message)).message, message);
  });
});
