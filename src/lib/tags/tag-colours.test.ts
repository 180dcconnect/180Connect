import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TAG_COLOURS,
  isTagColour,
  parseTagColour,
  tagPillStyle,
} from "./tag-colours.ts";

describe("TAG_COLOURS — the palette itself", () => {
  it("holds lowercase #rrggbb values, the exact format the DB stores", () => {
    for (const { hex } of TAG_COLOURS) {
      assert.match(hex, /^#[0-9a-f]{6}$/);
    }
  });

  it("has no duplicates — a repeated value would render two identical swatches", () => {
    assert.equal(new Set(TAG_COLOURS.map((c) => c.hex)).size, TAG_COLOURS.length);
  });
});

describe("parseTagColour (F194 AC1)", () => {
  it("accepts every palette member in any case, normalising to lowercase", () => {
    for (const { hex } of TAG_COLOURS) {
      const upper = parseTagColour(hex.toUpperCase());
      assert.ok(upper.valid);
      if (upper.valid) assert.equal(upper.colour, hex);
    }
  });

  it("treats absent input as no colour, not as an error", () => {
    for (const raw of [undefined, null, ""]) {
      const parsed = parseTagColour(raw);
      assert.ok(parsed.valid);
      if (parsed.valid) assert.equal(parsed.colour, null);
    }
  });

  it("refuses off-palette values, even well-formed hex", () => {
    const parsed = parseTagColour("#ff0000");
    assert.equal(parsed.valid, false);
    if (!parsed.valid) assert.match(parsed.message, /palette/i);
  });

  it("refuses non-hex strings and non-strings", () => {
    assert.equal(parseTagColour("red").valid, false);
    assert.equal(parseTagColour("#175cd").valid, false);
    assert.equal(parseTagColour(42).valid, false);
  });

  it("ignores surrounding whitespace before matching", () => {
    const parsed = parseTagColour("  #067647  ");
    assert.ok(parsed.valid);
    if (parsed.valid) assert.equal(parsed.colour, "#067647");
  });
});

describe("isTagColour", () => {
  it("narrows exactly the stored format", () => {
    assert.equal(isTagColour("#067647"), true);
    assert.equal(isTagColour(null), false);
    assert.equal(isTagColour("#ff0000"), false);
    assert.equal(isTagColour("#0676471A"), false);
  });
});

describe("tagPillStyle (F194 AC2/AC4)", () => {
  it("tints the pill with the tag's colour", () => {
    assert.deepEqual(tagPillStyle("#067647"), {
      backgroundColor: "#0676471A",
      color: "#067647",
    });
  });

  it("returns null so callers fall back to the default pill", () => {
    assert.equal(tagPillStyle(null), null);
    assert.equal(tagPillStyle(undefined), null);
    // A stale or hand-edited row must degrade, not break rendering.
    assert.equal(tagPillStyle("not-a-colour"), null);
    assert.equal(tagPillStyle("#ff0000"), null);
  });
});
