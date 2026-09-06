import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const threadSource = readFileSync(
  new URL("./outreach-history.tsx", import.meta.url),
  "utf8",
);
// The record is four tab routes now, not one page.tsx: the header owns the
// profile control and the outreach tab owns the in-thread one, so the gate this
// asserts on lives in those two files.
const headerSource = readFileSync(
  new URL("./record-header.tsx", import.meta.url),
  "utf8",
);
const outreachTabSource = readFileSync(
  new URL("./outreach/page.tsx", import.meta.url),
  "utf8",
);
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
    const gate = "const canSetStatus = isAdmin || isSelf;";
    // Defined identically on both sides, and each side gates its own control
    // on it — so neither surface can widen who may set the status alone.
    assert.ok(headerSource.includes(gate));
    assert.ok(outreachTabSource.includes(gate));
    assert.match(headerSource, /\{canSetStatus && \(/);
    assert.match(outreachTabSource, /statusControl=\{\s*canSetStatus/);
  });

  it("refreshes server-rendered timeline and dashboard data after saving", () => {
    assert.match(statusSource, /router\.refresh\(\)/);
    assert.match(statusSource, /fetch\(`\/api\/clients\/\$\{organisationId\}\/status`/);
  });
});
