import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const threadSource = readFileSync(
  new URL("./outreach-history.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const statusSource = readFileSync(
  new URL("./status-select.tsx", import.meta.url),
  "utf8",
);

describe("F137 reply status integration", () => {
  it("reuses the existing pipeline status control inside the full thread", () => {
    assert.match(threadSource, /import \{ StatusSelect \} from "\.\/status-select"/);
    assert.match(threadSource, /<StatusSelect[\s\S]*idSuffix="reply-thread"/);
    assert.doesNotMatch(threadSource, /fetch\([^)]*\/status/);
  });

  it("uses the same owner-or-admin presentation gate as the profile control", () => {
    const gate = "isAdmin || ownerId === authorization.actor.id";
    assert.equal(pageSource.split(gate).length - 1, 2);
  });

  it("refreshes server-rendered timeline and dashboard data after saving", () => {
    assert.match(statusSource, /router\.refresh\(\)/);
    assert.match(statusSource, /fetch\(`\/api\/clients\/\$\{organisationId\}\/status`/);
  });
});
