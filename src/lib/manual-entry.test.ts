import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canApproveManualEntry,
  checkManualEntryCriteria,
  manualEntrySchema,
  type ManualEntryApprovalChecks,
} from "./manual-entry.ts";

const input = { legalName: "Useful Charity", countryCode: "GB", website: "", contactEmail: "", registryName: "", registryNumber: "", reason: "Not present in available API sources." };

describe("manualEntrySchema", () => {
  it("accepts the approved Data Model fields", () => assert.equal(manualEntrySchema.safeParse(input).success, true));
  it("rejects missing name and an unexplained submission", () => assert.equal(manualEntrySchema.safeParse({ ...input, legalName: "", reason: "why" }).success, false));
});

describe("canApproveManualEntry", () => {
  it("fails closed while any dependency integration is unavailable", async () => {
    const checks: ManualEntryApprovalChecks = {
      checkDuplicate: async () => ({ status: "not_available", dependency: "F042" }),
      checkWebsite: async () => ({ status: "passed" }),
    };
    const result = await canApproveManualEntry(input, checks, { organisationType: "charity" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.messages[0], /F042/);
  });
  it("allows approval only after F042, F046 and the real F047 check pass", async () => {
    const pass = async () => ({ status: "passed" as const });
    assert.deepEqual(
      await canApproveManualEntry(
        input,
        { checkDuplicate: pass, checkWebsite: pass },
        { organisationType: "charity", countryCode: "GB" },
      ),
      { ok: true },
    );
  });
});

describe("checkManualEntryCriteria", () => {
  it("fails closed when organisation type evidence is missing", () => {
    assert.deepEqual(checkManualEntryCriteria(), {
      status: "blocked",
      message: "Select or derive an organisation type before approving this manual entry.",
    });
  });

  it("passes an eligible charity through the shared F047 checker", () => {
    assert.deepEqual(checkManualEntryCriteria({ organisationType: "charity" }), { status: "passed" });
  });

  it("requires an explicit admin decision for an ambiguous company", () => {
    const result = checkManualEntryCriteria({ organisationType: "company" });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") assert.match(result.message, /admin eligibility decision/i);
    assert.deepEqual(
      checkManualEntryCriteria({ organisationType: "company", adminConfirmedEligible: true }),
      { status: "passed" },
    );
  });

  it("does not allow an organisation type outside F047 policy", () => {
    const result = checkManualEntryCriteria({ organisationType: "government" });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") assert.match(result.message, /does not meet/i);
  });
});
