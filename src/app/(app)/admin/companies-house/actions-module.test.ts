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
    // The zero-input discovery action is retired: bulk imports run through the
    // staged register (register-actions.ts), not the live API.
    assert.doesNotMatch(source, /importCompaniesHouseAuto/);
  });

  // The confirmation dialog has to state the ceiling before the click, and a
  // "use server" module may only export async functions — so the constant is
  // duplicated in the client component rather than imported. Pinned as text,
  // because a silent drift here means the button promises 716,282 companies
  // and the run imports 10,000, which is exactly the bug this replaced.
  it("keeps the client-side import ceiling equal to the server's", async () => {
    const [server, client] = await Promise.all([
      readFile("src/app/admin/companies-house/register-actions.ts", "utf8"),
      readFile("src/app/admin/companies-house/filter-builder.tsx", "utf8"),
    ]);

    const capOf = (source: string) =>
      source.match(/const MAX_IMPORT = ([\d_]+);/)?.[1];

    const serverCap = capOf(server);
    const clientCap = capOf(client);
    assert.ok(serverCap, "register-actions.ts should declare MAX_IMPORT");
    assert.ok(clientCap, "filter-builder.tsx should declare MAX_IMPORT");
    assert.equal(clientCap, serverCap);
  });

  // The cap is applied inside selectCompanies, so every count downstream of it
  // reports the capped number. Comparing one of those to the cap can only ever
  // be false, which silently marked over-cap runs "completed".
  it("decides the partial status from the pre-cap count", async () => {
    const source = await readFile(
      "src/app/admin/companies-house/register-actions.ts",
      "utf8",
    );

    assert.doesNotMatch(source, /outcome\.selected\s*>\s*cap/);
    assert.match(source, /const available = countCompanies\(parsed\)/);
    assert.match(source, /const truncated = available > cap/);
    assert.match(source, /job_status: truncated \? "partial" : "completed"/);
  });
});
