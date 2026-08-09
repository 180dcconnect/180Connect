import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("Companies House server-action module", () => {
  it("exports no runtime values except async server actions", async () => {
    const source = await readFile(
      "src/app/admin/companies-house/actions.ts",
      "utf8",
    );

    assert.doesNotMatch(source, /export\s+const\s+/);
    assert.doesNotMatch(source, /export\s+let\s+/);
    assert.match(source, /export\s+async\s+function\s+importCompaniesHouse\b/);
    assert.match(source, /export\s+async\s+function\s+importCompaniesHouseBulk/);
  });
});
