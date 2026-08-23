import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function source(relative: string) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

describe("F250 human-send architecture", () => {
  it("keeps Gmail transport out of every AI generation endpoint", async () => {
    const generationSources = await Promise.all([
      source("../../app/api/clients/[id]/booklet/route.ts"),
      source("../../app/api/clients/[id]/outreach-drafts/stage-one/route.ts"),
      source("../../app/api/clients/[id]/outreach-drafts/stage-two/route.ts"),
    ]);
    for (const text of generationSources) {
      assert.doesNotMatch(text, /sendBranchOutreach|sendGmailMessage|messages\/send/);
    }
  });

  it("requires the explicit review gate before the interactive send call", async () => {
    const action = await source("../../app/clients/[id]/outreach-actions.ts");
    assert.match(action, /humanReviewDecision\("stage_one", explicitlyApproved\)/);
    assert.match(action, /sendBranchOutreach/);
    assert.ok(action.indexOf("humanReviewDecision") < action.lastIndexOf("sendBranchOutreach"));
  });

  it("makes the deliberate control unambiguous to the CAM", async () => {
    const editor = await source("../../app/clients/[id]/compose-button.tsx");
    assert.match(editor, /Send reviewed email/);
    assert.match(editor, /I have reviewed the recipient, subject and body/);
  });
});
