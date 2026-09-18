import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  editDiffers,
  MAX_BOOKLET_EDIT_CHARS,
  parseBookletEditInput,
} from "./edit-validation.ts";

describe("parseBookletEditInput", () => {
  const good = {
    organisationId: "11111111-1111-4111-8111-111111111111",
    baseVersionId: "22222222-2222-4222-8222-222222222222",
    text: "  A corrected booklet.  ",
  };

  it("accepts a well-formed edit and trims the text", () => {
    const result = parseBookletEditInput(good);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.text, "A corrected booklet.");
      assert.equal(result.data.organisationId, good.organisationId);
      assert.equal(result.data.baseVersionId, good.baseVersionId);
    }
  });

  it("refuses a blank edit in plain words", () => {
    const result = parseBookletEditInput({ ...good, text: "   " });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /empty booklet/);
  });

  it("refuses an over-long edit in plain words", () => {
    const result = parseBookletEditInput({ ...good, text: "x".repeat(MAX_BOOKLET_EDIT_CHARS + 1) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /20000 characters or fewer/);
  });

  it("refuses a malformed payload without leaking which id was bad", () => {
    const result = parseBookletEditInput({ ...good, baseVersionId: "not-a-uuid" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.doesNotMatch(result.message, /not-a-uuid/);
  });
});

describe("editDiffers", () => {
  it("ignores surrounding whitespace when comparing", () => {
    assert.equal(editDiffers("Same words.", "  Same words.\n"), false);
    assert.equal(editDiffers("Same words.", "Different words."), true);
  });
});
