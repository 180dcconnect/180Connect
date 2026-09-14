import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inboxQuery,
  knownIdsUrl,
  syncUrl,
  tokenCacheFrom,
  unseenIds,
  usableToken,
} from "../../../supabase/functions/gmail-reply-check/logic.ts";

describe("gmail-reply-check logic", () => {
  it("lists the last two minutes of inbox by epoch seconds", () => {
    assert.equal(inboxQuery(1_790_000_000_500), "in:inbox after:1789999880");
  });

  it("reuses a cached token until a minute before expiry", () => {
    const cache = tokenCacheFrom({ access_token: "tok", expires_in: 3600 }, 0);
    assert.equal(usableToken(cache, 0), "tok");
    assert.equal(usableToken(cache, 3_540_000 - 1), "tok");
    assert.equal(usableToken(cache, 3_540_000), null);
    assert.equal(usableToken(null, 0), null);
    assert.equal(tokenCacheFrom({ expires_in: 3600 }, 0), null);
  });

  it("looks up both captured and review-flagged ids", () => {
    const url = new URL(knownIdsUrl("https://ref.supabase.co", ["a1", "b\"2"]));
    assert.equal(url.pathname, "/rest/v1/audit_log");
    assert.equal(url.searchParams.get("action"), "in.(gmail_reply_captured,gmail_reply_needs_review)");
    assert.equal(url.searchParams.get("detail->>provider_message_id"), 'in.("a1","b2")');
  });

  it("keeps only ids the app has not recorded", () => {
    assert.deepEqual(unseenIds(["a", "b", "c"], ["b"]), ["a", "c"]);
  });

  it("builds the narrowed Vercel sync URL and refuses non-https targets", () => {
    assert.equal(
      syncUrl("https://staging.example.app/", "bypass"),
      "https://staging.example.app/api/cron/gmail-replies?sinceMinutes=5&x-vercel-protection-bypass=bypass",
    );
    assert.equal(syncUrl("https://staging.example.app", ""), "https://staging.example.app/api/cron/gmail-replies?sinceMinutes=5");
    assert.equal(syncUrl("http://evil.example", "x"), null);
    assert.equal(syncUrl("not a url", "x"), null);
    assert.equal(syncUrl(undefined, "x"), null);
    assert.equal(syncUrl("http://localhost:3000", null), "http://localhost:3000/api/cron/gmail-replies?sinceMinutes=5");
  });
});
