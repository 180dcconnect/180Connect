import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_FULL_NAME_LENGTH,
  parseAccountSettings,
} from "./account-settings.ts";

/**
 * Invisible characters are written as escapes rather than pasted literally so
 * that the intent of each case survives being read, diffed and reformatted.
 */
const ZERO_WIDTH_SPACE = "\u200b";
const BOM = "\ufeff";
const CONTROL = "\u0001";

test("accepts a normal name unchanged", () => {
  const result = parseAccountSettings({ fullName: "Alvia Zehra" });
  assert.deepEqual(result, { ok: true, value: { fullName: "Alvia Zehra" } });
});

test("trims surrounding whitespace and collapses internal runs", () => {
  const result = parseAccountSettings({ fullName: "  Ada   Lovelace \t " });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.fullName, "Ada Lovelace");
});

test("strips control and zero-width characters", () => {
  const result = parseAccountSettings({
    fullName: `Ada${ZERO_WIDTH_SPACE}${CONTROL}Lovelace`,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.fullName, "Ada Lovelace");
});

test("rejects an empty name", () => {
  const result = parseAccountSettings({ fullName: "   " });
  assert.deepEqual(result, { ok: false, message: "Enter your name." });
});

test("rejects a name that is only invisible characters", () => {
  const result = parseAccountSettings({
    fullName: `${ZERO_WIDTH_SPACE}${ZERO_WIDTH_SPACE}${BOM}`,
  });
  assert.equal(result.ok, false);
});

test("rejects a missing field the same way as an empty one", () => {
  const result = parseAccountSettings({ fullName: undefined });
  assert.deepEqual(result, { ok: false, message: "Enter your name." });
});

test("rejects a non-string field", () => {
  const result = parseAccountSettings({ fullName: { toString: () => "x" } });
  assert.equal(result.ok, false);
});

test("accepts a name exactly at the length cap", () => {
  const name = "a".repeat(MAX_FULL_NAME_LENGTH);
  const result = parseAccountSettings({ fullName: name });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.fullName, name);
});

test("rejects a name past the length cap", () => {
  const result = parseAccountSettings({
    fullName: "a".repeat(MAX_FULL_NAME_LENGTH + 1),
  });
  assert.equal(result.ok, false);
  assert.equal(
    !result.ok && result.message,
    `Name must be ${MAX_FULL_NAME_LENGTH} characters or fewer.`,
  );
});

test("measures the length after normalisation, not before", () => {
  // Padding that normalises away must not count against the cap.
  const name = `${"a".repeat(MAX_FULL_NAME_LENGTH)}${ZERO_WIDTH_SPACE.repeat(5)}`;
  const result = parseAccountSettings({ fullName: name });
  assert.equal(result.ok, true);
});
