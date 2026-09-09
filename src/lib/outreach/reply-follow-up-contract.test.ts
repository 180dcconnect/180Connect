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

  it("wires each reply to its own draft trigger", async () => {
    // Composing moved wholesale into the inbox, so the client record's
    // follow-up button is gone and the reading pane's ReplyComposer is the
    // surface that answers a reply. It still names which reply it is
    // answering, and still shows the draft for review before anything sends.
    const composer = await source("../../components/outreach/reply-composer.tsx");
    assert.match(composer, /JSON\.stringify\(\{ length, register, closing, replyEventId \}\)/);
    assert.match(composer, /EmailReviewPanel/, "the drafted response must be shown before it can send");

    // The id comes from the message the CAM hit Reply on when a
    // per-message Reply is used, otherwise the thread's most recent
    // inbound message — so a reply answers what is on screen rather
    // than the thread in general.
    const pane = await source("../../components/inbox/gmail-reading-pane.tsx");
    assert.match(
      pane,
      /replyEventId=\{replyTarget\?\.id \?\? lastClientReply\(thread\)\?\.id\}/,
    );
  });

  it("can only persist the generated response as a draft", async () => {
    const route = await source("../../app/api/clients/[id]/outreach-drafts/stage-two/route.ts");

    assert.match(route, /send_status: "draft"/);
    assert.doesNotMatch(route, /sendBranchOutreach|sendGmailMessage|messages\/send/);
  });
});
