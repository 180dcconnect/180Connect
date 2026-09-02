import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MOCK_INBOX_THREADS,
  getMockThreadById,
  formatGmailTimestamp,
  formatFileSize,
} from "./inbox-mock-data.ts";

describe("inbox-mock-data", () => {
  it("provides populated mock threads with required fields", () => {
    assert.ok(MOCK_INBOX_THREADS.length >= 10);
    for (const thread of MOCK_INBOX_THREADS) {
      assert.ok(thread.id);
      assert.ok(thread.orgName);
      assert.ok(thread.subject);
      assert.ok(thread.snippet);
      assert.ok(thread.messages.length > 0);
      assert.ok(thread.primaryContact.name);
      assert.ok(thread.primaryContact.email);
    }
  });

  it("finds mock thread by id", () => {
    const thread = getMockThreadById("mock-org-cruk");
    assert.ok(thread);
    assert.equal(thread?.orgName, "Cancer Research UK");
  });

  it("returns undefined for unknown thread id", () => {
    assert.equal(getMockThreadById("unknown-org-id"), undefined);
  });

  it("formats file sizes correctly in KB and MB", () => {
    assert.equal(formatFileSize(500000), "500 KB");
    assert.equal(formatFileSize(2500000), "2.5 MB");
  });

  it("formats timestamps cleanly", () => {
    const nowIso = new Date().toISOString();
    const formatted = formatGmailTimestamp(nowIso);
    assert.ok(formatted.length > 0);
  });
});
