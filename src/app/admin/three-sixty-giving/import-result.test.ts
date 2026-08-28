import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunSummary } from "@/lib/ingestion/type";
import { importStateFromSummary } from "./import-result.ts";

function summary(
  status: RunSummary["status"],
  walkedOrganisations?: number,
  error?: string,
): RunSummary {
  const nothingToWalk = walkedOrganisations === 0;
  return {
    source: "360giving",
    status,
    counts: nothingToWalk
      ? { fetched: 0, inserted: 0, skipped: 0, failed: 0 }
      : { fetched: 5, inserted: 2, skipped: 2, failed: 1 },
    written: { new: 1, changed: 1 },
    runId: "11111111-1111-1111-1111-111111111111",
    error: status === "failed" ? (error ?? "secret upstream detail") : undefined,
    walkedOrganisations,
  };
}

describe("importStateFromSummary", () => {
  it("shows successful import counts", () => {
    const state = importStateFromSummary(summary("completed", 42));
    assert.equal(state.kind, "success");
    assert.deepEqual(state.counts, {
      fetched: 5,
      written: 2,
      skipped: 2,
      failed: 1,
    });
  });

  it("makes partial imports visible as warnings", () => {
    assert.equal(importStateFromSummary(summary("partial", 42)).kind, "warning");
  });

  it("warns instead of claiming success when there was nothing to walk", () => {
    const state = importStateFromSummary(summary("completed", 0));
    assert.equal(state.kind, "warning");
    assert.match(state.message, /no organisations to ask about/);
    assert.deepEqual(state.counts, { fetched: 0, written: 0, skipped: 0, failed: 0 });
  });

  it("does not expose upstream failure details", () => {
    const state = importStateFromSummary(summary("failed"));
    assert.equal(state.kind, "error");
    assert.doesNotMatch(state.message, /secret upstream detail/);
  });

  it("shows safe lookup failures so the admin can correct the input", () => {
    const message = "Enter a Charity Commission registration number.";
    assert.equal(importStateFromSummary(summary("failed", undefined, message)).message, message);
  });
});
