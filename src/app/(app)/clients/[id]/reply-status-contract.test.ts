import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The record header still owns the profile-level pipeline status control.
const headerSource = readFileSync(
  new URL("./record-header.tsx", import.meta.url),
  "utf8",
);
const statusSource = readFileSync(
  new URL("./status-select.tsx", import.meta.url),
  "utf8",
);

describe("F137 reply status integration", () => {
  it("the profile header owns the pipeline status control with the owner-or-admin gate", () => {
    const gate = "const canSetStatus = isAdmin || isSelf;";
    assert.ok(headerSource.includes(gate));
    assert.match(headerSource, /\{canSetStatus && \(/);
  });

  it("the inline thread status control was removed — status is set from the header or status-select only", () => {
    // outreach-history.tsx should no longer import or render StatusSelect
    const outreachSource = readFileSync(
      new URL("./outreach-history.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(outreachSource, /import.*StatusSelect/);
    assert.doesNotMatch(outreachSource, /<StatusSelect/);
  });

  it("refreshes server-rendered timeline and dashboard data after saving", () => {
    assert.match(statusSource, /router\.refresh\(\)/);
    assert.match(statusSource, /fetch\(`\/api\/clients\/\$\{organisationId\}\/status`/);
  });
});
