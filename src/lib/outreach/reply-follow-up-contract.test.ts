import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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

  it("keeps the verifiable news source with the draft", async () => {
    const route = await source("../../app/api/clients/[id]/outreach-drafts/stage-two/route.ts");

    // The response carries the hook and its URL for review-time verification…
    assert.match(route, /newsHook: liveNews\?\.text \?\? null/);
    assert.match(route, /newsUrl: liveNews\?\.url \?\? null/);
    // …and the URL is persisted verbatim in ai_generations.prompt_user via the
    // prompt context, because outreach_messages has no vessel for it and a URL
    // that lives only in the transient response is unverifiable on reopen.
    assert.match(route, /Source: \$\{liveNews\.url\}/);
  });

  it("shows the live news source link for verification during review", async () => {
    const panel = await source("../../components/outreach/email-review-panel.tsx");
    const composer = await source("../../components/outreach/reply-composer.tsx");

    for (const text of [panel, composer]) {
      assert.match(text, /newsUrl\?: string \| null/);
    }
    // Unverifiable hooks render nothing: the line requires a live URL, and
    // the link opens a new tab without leaking a referrer.
    assert.match(panel, /draft\.newsSource === "live" && draft\.newsUrl/);
    assert.match(panel, /target="_blank"/);
    assert.match(panel, /rel="noreferrer"/);
  });

  it("persists the news triple on the draft row and restores it on reopen", async () => {
    const route = await source("../../app/api/clients/[id]/outreach-drafts/stage-two/route.ts");
    assert.match(route, /news_source: liveNews \? "live" : null/);
    assert.match(route, /news_hook: liveNews\?\.text \?\? null/);
    assert.match(route, /news_url: liveNews\?\.url \?\? null/);

    const threadRoute = await source("../../app/api/inbox/[orgId]/thread/route.ts");
    for (const column of ["news_source", "news_hook", "news_url"]) {
      assert.match(threadRoute, new RegExp(column), `thread hydrate must select ${column}`);
    }

    const shell = await source("../../components/inbox/gmail-inbox-shell.tsx");
    assert.match(shell, /newsUrl: last\?\.newsUrl/);
    const modal = await source("../../components/inbox/gmail-compose-modal.tsx");
    assert.match(modal, /initialNewsUrl\?: string \| null/);
    assert.match(modal, /initialNewsSource === "live" && initialNewsUrl/);

    // The migration filename carries a timestamp that is re-dated whenever
    // dev moves ahead of the branch, so find it by suffix, not by name.
    const migrations = await readdir(new URL("../../../supabase/migrations/", import.meta.url));
    const migration = migrations.find((name) => name.endsWith("_add_stage_two_news_hook_columns.sql"));
    assert.ok(migration, "the news columns migration must exist");
    const sql = await readFile(
      new URL(`../../../supabase/migrations/${migration}`, import.meta.url),
      "utf8",
    );
    for (const column of ["news_source", "news_hook", "news_url"]) {
      assert.match(sql, new RegExp(`add column if not exists ${column}`));
    }
  });
});
