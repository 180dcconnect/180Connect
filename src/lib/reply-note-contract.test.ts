import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function source(relative: string) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

describe("F136 add note from reply contract", () => {
  it("uses the existing F072 endpoint and note insert", async () => {
    const form = await source("../app/clients/[id]/add-note-form.tsx");
    const route = await source("../app/api/clients/[id]/notes/route.ts");

    assert.match(form, /`\/api\/clients\/\$\{organisationId\}\/notes`/);
    assert.match(route, /\.from\("notes"\)[\s\S]*?\.insert\(\{/);
    assert.match(route, /author_id: authorization\.actor\.id/);
    assert.match(route, /content,/);
  });

  it("server-verifies the selected reply belongs to the same client", async () => {
    const route = await source("../app/api/clients/[id]/notes/route.ts");

    assert.match(route, /replyEventId: z\.uuid\(\)\.optional\(\)/);
    assert.match(route, /\.from\("reply_events"\)[\s\S]*?\.eq\("id", parsed\.data\.replyEventId\)[\s\S]*?\.eq\("organisation_id", organisationId\)/);
    assert.doesNotMatch(route, /replyBody: z\./, "the browser must not supply reply context");
  });

  it("only offers the reply-note action to users with client edit permission", async () => {
    const page = await source("../app/clients/[id]/page.tsx");
    const thread = await source("../app/clients/[id]/outreach-history.tsx");

    assert.match(page, /noteOrganisationId=\{canEdit \? client\.id : undefined\}/);
    assert.match(thread, /replyEventId=\{entry\.id\}/);
    assert.match(thread, /AddNoteForm/);
  });
});
