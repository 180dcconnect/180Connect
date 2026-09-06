import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function source(relative: string) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

describe("F135 reply follow-up contract", () => {
  it("accepts only a reply id from the browser and loads the actual reply under the client", async () => {
    const route = await source("../../app/api/clients/[id]/outreach-drafts/stage-two/route.ts");

    assert.match(route, /replyEventId: z\.uuid\(\)\.optional\(\)/);
    assert.doesNotMatch(route, /replyBody: z\./, "reply text must never be trusted from the browser");
    assert.match(route, /\.from\("reply_events"\)[\s\S]*?\.eq\("id", parsed\.data\.replyEventId\)[\s\S]*?\.eq\("organisation_id", organisationId\)/);
    assert.match(route, /replyBody: replyEvent\?\.reply_body \?\? null/);
  });

  it("wires each displayed reply to its own draft trigger", async () => {
    const thread = await source("../../app/clients/[id]/outreach-history.tsx");
    const button = await source("../../app/clients/[id]/follow-up-button.tsx");

    assert.match(thread, /replyEventId=\{entry\.id\}/);
    assert.match(button, /JSON\.stringify\(\{ length, voice, tone, closing, replyEventId \}\)/);
    assert.match(button, /Review drafted response/);
  });

  it("can only persist the generated response as a draft", async () => {
    const route = await source("../../app/api/clients/[id]/outreach-drafts/stage-two/route.ts");

    assert.match(route, /send_status: "draft"/);
    assert.doesNotMatch(route, /sendBranchOutreach|sendGmailMessage|messages\/send/);
  });
});
