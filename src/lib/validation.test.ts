import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import {
  boundedInt,
  emailField,
  nonEmptyTrimmed,
  safeValidate,
  urlField,
} from "./validation.ts";

describe("safeValidate", () => {
  const schema = z.object({ name: nonEmptyTrimmed(10) });

  it("returns the parsed data on success", () => {
    const result = safeValidate(schema, { name: " Ada " });
    assert.deepEqual(result, { success: true, data: { name: "Ada" } });
  });

  it("returns field errors instead of throwing on invalid input", () => {
    const result = safeValidate(schema, { name: "" });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.fieldErrors.name?.length);
    }
  });

  it("reports every invalid field at once", () => {
    const multiField = z.object({ a: nonEmptyTrimmed(5), b: emailField() });
    const result = safeValidate(multiField, { a: "", b: "not-an-email" });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.deepEqual(Object.keys(result.fieldErrors).sort(), ["a", "b"]);
    }
  });
});

describe("nonEmptyTrimmed", () => {
  const schema = nonEmptyTrimmed(5);

  it("trims surrounding whitespace", () => {
    assert.equal(schema.parse("  hi  "), "hi");
  });

  it("rejects an empty string", () => {
    assert.throws(() => schema.parse(""));
  });

  it("rejects a whitespace-only string", () => {
    assert.throws(() => schema.parse("   "));
  });

  it("rejects a string longer than max", () => {
    assert.throws(() => schema.parse("toolong"));
  });
});

describe("emailField", () => {
  const schema = emailField();

  it("accepts a valid address and lowercases it", () => {
    assert.equal(schema.parse("Person@Example.com"), "person@example.com");
  });

  it("rejects a malformed address", () => {
    assert.throws(() => schema.parse("not-an-email"));
  });
});

describe("urlField", () => {
  const schema = urlField();

  it("accepts an https URL", () => {
    assert.equal(schema.parse("https://example.com"), "https://example.com");
  });

  it("rejects a non-http(s) protocol", () => {
    assert.throws(() => schema.parse("ftp://example.com"));
  });

  it("rejects a bare host with no protocol", () => {
    assert.throws(() => schema.parse("example.com"));
  });
});

describe("boundedInt", () => {
  const schema = boundedInt(1, 10);

  it("accepts a value within range", () => {
    assert.equal(schema.parse(5), 5);
  });

  it("rejects a value below the minimum", () => {
    assert.throws(() => schema.parse(0));
  });

  it("rejects a value above the maximum", () => {
    assert.throws(() => schema.parse(11));
  });

  it("rejects a non-integer", () => {
    assert.throws(() => schema.parse(1.5));
  });
});
