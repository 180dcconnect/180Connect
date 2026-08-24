import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INVALID_NOTIFICATION_FREQUENCY_MESSAGE,
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
  const result = parseAccountSettings({
    fullName: "Alvia Zehra",
    notificationFrequency: "immediate",
  });
  assert.deepEqual(result, {
    ok: true,
    value: { fullName: "Alvia Zehra", notificationFrequency: "immediate" },
  });
});

test("trims surrounding whitespace and collapses internal runs", () => {
  const result = parseAccountSettings({
    fullName: "  Ada   Lovelace \t ",
    notificationFrequency: "immediate",
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.fullName, "Ada Lovelace");
});

test("strips control and zero-width characters", () => {
  const result = parseAccountSettings({
    fullName: `Ada${ZERO_WIDTH_SPACE}${CONTROL}Lovelace`,
    notificationFrequency: "immediate",
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.fullName, "Ada Lovelace");
});

test("rejects an empty name", () => {
  const result = parseAccountSettings({
    fullName: "   ",
    notificationFrequency: "immediate",
  });
  assert.deepEqual(result, { ok: false, message: "Enter your name." });
});

test("rejects a name that is only invisible characters", () => {
  const result = parseAccountSettings({
    fullName: `${ZERO_WIDTH_SPACE}${ZERO_WIDTH_SPACE}${BOM}`,
  });
  assert.equal(result.ok, false);
});

test("rejects a missing field the same way as an empty one", () => {
  const result = parseAccountSettings({
    fullName: undefined,
    notificationFrequency: "immediate",
  });
  assert.deepEqual(result, { ok: false, message: "Enter your name." });
});

test("rejects a non-string field", () => {
  const result = parseAccountSettings({
    fullName: { toString: () => "x" },
    notificationFrequency: "immediate",
  });
  assert.equal(result.ok, false);
});

test("accepts a name exactly at the length cap", () => {
  const name = "a".repeat(MAX_FULL_NAME_LENGTH);
  const result = parseAccountSettings({
    fullName: name,
    notificationFrequency: "immediate",
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.fullName, name);
});

test("rejects a name past the length cap", () => {
  const result = parseAccountSettings({
    fullName: "a".repeat(MAX_FULL_NAME_LENGTH + 1),
    notificationFrequency: "immediate",
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
  const result = parseAccountSettings({
    fullName: name,
    notificationFrequency: "immediate",
  });
  assert.equal(result.ok, true);
});

test("accepts immediate when explicitly provided (F201)", () => {
  const result = parseAccountSettings({
    fullName: "Bashir",
    notificationFrequency: "immediate",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.notificationFrequency, "immediate");
  }
});

test("accepts valid notification delivery frequencies (F201)", () => {
  const daily = parseAccountSettings({ fullName: "Bashir", notificationFrequency: "daily" });
  assert.equal(daily.ok, true);
  if (daily.ok) {
    assert.equal(daily.value.notificationFrequency, "daily");
  }

  const weekly = parseAccountSettings({ fullName: "Bashir", notificationFrequency: "weekly" });
  assert.equal(weekly.ok, true);
  if (weekly.ok) {
    assert.equal(weekly.value.notificationFrequency, "weekly");
  }
});

test("rejects an invalid notification frequency instead of coercing (F201 review)", () => {
  const invalid = parseAccountSettings({ fullName: "Bashir", notificationFrequency: "hourly" });
  assert.deepEqual(invalid, {
    ok: false,
    message: INVALID_NOTIFICATION_FREQUENCY_MESSAGE,
  });
});

test("rejects a missing notification frequency instead of coercing (F201 review)", () => {
  const missing = parseAccountSettings({
    fullName: "Bashir",
    notificationFrequency: undefined,
  });
  assert.deepEqual(missing, {
    ok: false,
    message: INVALID_NOTIFICATION_FREQUENCY_MESSAGE,
  });

  const nullField = parseAccountSettings({
    fullName: "Bashir",
    notificationFrequency: null,
  });
  assert.deepEqual(nullField, {
    ok: false,
    message: INVALID_NOTIFICATION_FREQUENCY_MESSAGE,
  });
});
