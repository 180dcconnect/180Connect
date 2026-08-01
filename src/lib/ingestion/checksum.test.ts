import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashPayload, stableStringify } from "./checksum.ts";

describe("stableStringify", () => {
  it("is insensitive to key order at the top level", () => {
    assert.equal(
      stableStringify({ b: 1, a: 2 }),
      stableStringify({ a: 2, b: 1 }),
    );
  });

  it("is insensitive to key order at every depth", () => {
    assert.equal(
      stableStringify({ outer: { z: 1, a: { y: 2, b: 3 } } }),
      stableStringify({ outer: { a: { b: 3, y: 2 }, z: 1 } }),
    );
  });

  it("keeps nested values instead of dropping them", () => {
    // The bug this guards against: JSON.stringify(v, Object.keys(v).sort())
    // applies the key list recursively and serialises `address` as {}.
    const serialised = stableStringify({
      company_number: "1",
      address: { locality: "London" },
    });
    assert.ok(serialised.includes("London"));
  });

  it("preserves array order, which is meaningful", () => {
    assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  });

  it("handles null and primitives without throwing", () => {
    assert.equal(stableStringify(null), "null");
    assert.equal(stableStringify(7), "7");
    assert.equal(stableStringify("x"), '"x"');
  });
});

describe("hashPayload", () => {
  it("returns the same hash for the same data in a different field order", () => {
    const a = { company_number: "1", title: "X", address: { locality: "L" } };
    const b = { address: { locality: "L" }, title: "X", company_number: "1" };
    assert.equal(hashPayload(a), hashPayload(b));
  });

  it("changes when a deeply nested field changes", () => {
    const before = {
      company_number: "1",
      address: { locality: "London", postal_code: "E1" },
    };
    const after = {
      company_number: "1",
      address: { locality: "Manchester", postal_code: "M1" },
    };
    assert.notEqual(hashPayload(before), hashPayload(after));
  });

  it("produces a sha256 hex digest", () => {
    assert.match(hashPayload({ a: 1 }), /^[0-9a-f]{64}$/);
  });

  it("does not throw on a null payload", () => {
    assert.match(hashPayload(null), /^[0-9a-f]{64}$/);
  });
});
