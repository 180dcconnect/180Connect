import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canApproveManualEntry, manualEntrySchema, type ManualEntryApprovalChecks } from "./manual-entry.ts";

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
      checkCriteria: async () => ({ status: "passed" }),
    };
    const result = await canApproveManualEntry(input, checks);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.messages[0], /F042/);
  });
  it("allows approval only after all three checks pass", async () => {
    const pass = async () => ({ status: "passed" as const });
    assert.deepEqual(await canApproveManualEntry(input, { checkDuplicate: pass, checkWebsite: pass, checkCriteria: pass }), { ok: true });
  });
});
