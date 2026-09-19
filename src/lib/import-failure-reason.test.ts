import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeImportFailure, failureNote, summariseImportFailure } from "./import-failure-reason.ts";

describe("describeImportFailure", () => {
  it("has nothing to say about nothing", () => {
    assert.equal(describeImportFailure(null), null);
    assert.equal(describeImportFailure("   "), null);
  });

  it("names the missing database update behind the enum failure", () => {
    // The exact message every charity register import hit on staging and
    // production until 20261018150000 repaired the promote function.
    const reason = describeImportFailure(
      'invalid input value for enum public.outreach_status: "not_started"',
    );
    assert.ok(reason);
    assert.match(reason.summary, /database update/);
    assert.equal(reason.retryable, false);
    assert.match(reason.actionHint, /developer/);
  });

  it("never puts the database's own words in what the reader is shown", () => {
    const raw = 'invalid input value for enum public.outreach_status: "not_started"';
    const reason = describeImportFailure(raw)!;
    for (const text of [reason.summary, reason.description, reason.actionHint]) {
      assert.doesNotMatch(text, /enum|public\.|outreach_status|null value|constraint/i);
    }
    // The raw text is still carried, for the developer who is shown it on
    // purpose rather than by accident.
    assert.equal(reason.rawMessage, raw);
  });

  it("tells a reader to retry the failures a retry can fix, and not the others", () => {
    assert.equal(describeImportFailure("deadlock detected")!.retryable, true);
    assert.equal(describeImportFailure("fetch failed")!.retryable, true);
    assert.equal(
      describeImportFailure("permission denied for table organisations")!.retryable,
      false,
    );
  });

  it("still gives a sentence and a next step for a message it does not know", () => {
    const reason = describeImportFailure("something nobody has seen before")!;
    assert.match(reason.summary, /could not be saved/);
    assert.ok(reason.actionHint.length > 0);
    assert.notEqual(reason.description, "something nobody has seen before");
  });
});

describe("failureNote", () => {
  it("counts the records and names the reason in one clause", () => {
    const note = failureNote(311, ['invalid input value for enum public.outreach_status: "x"']);
    assert.match(note, /^311 records could not be saved — /);
    assert.match(note, /database update/);
  });

  it("says the count alone when no reason was recorded", () => {
    assert.equal(failureNote(1), "1 record could not be saved to the client list");
  });
});

describe("summariseImportFailure", () => {
  it("leads with the fact that nothing was added when nothing was", () => {
    const reason = describeImportFailure("permission denied");
    assert.match(summariseImportFailure(311, 0, reason), /^Nothing was added to the client list/);
  });

  it("keeps the two halves apart when some records did save", () => {
    assert.match(summariseImportFailure(5, 20, null), /^5 records could not be saved/);
  });
});
