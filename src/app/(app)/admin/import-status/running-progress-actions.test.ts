import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const ACTIONS = [
  {
    path: "src/app/(app)/admin/charity-commission/register-actions.ts",
    promotion: "const promoted = await promotePendingCharityCommissionBulkRecords()",
  },
  {
    path: "src/app/(app)/admin/companies-house/register-actions.ts",
    promotion: "const promoted = await promotePendingCompaniesHouseRecords()",
  },
] as const;

describe("register import progress lifecycle", () => {
  for (const action of ACTIONS) {
    it(`keeps ${action.path} running until promotion finishes`, async () => {
      const source = await readFile(action.path, "utf8");
      const stagingStarts = source.indexOf("const outcome = await importSelection");
      const promotionStarts = source.indexOf(action.promotion, stagingStarts);
      const auditStarts = source.indexOf("await supabase.from(\"audit_log\")", promotionStarts);

      assert.ok(stagingStarts >= 0 && promotionStarts > stagingStarts && auditStarts > promotionStarts);

      const staging = source.slice(stagingStarts, promotionStarts);
      const finishing = source.slice(promotionStarts, auditStarts);

      assert.doesNotMatch(staging, /job_status\s*:/);
      assert.match(staging, /registerImportProgressStats\(outcome\.selected\)/);
      assert.match(finishing, /completed_at\s*:/);
      assert.match(finishing, /job_status\s*:/);
    });
  }
});
