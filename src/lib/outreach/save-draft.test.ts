import assert from "node:assert/strict";
import test from "node:test";
import { safeValidate } from "../validation.ts";
import { saveDraftSchema } from "./save-draft.ts";

const valid = {
  organisationId: "00000000-0000-4000-a000-000000000001",
  messageId: "00000000-0000-4000-a000-000000000002",
  subject: "Hello",
  body: "<p>Work in progress</p>",
};

function firstError(input: unknown): string {
  const parsed = safeValidate(saveDraftSchema, input);
  if (parsed.success) return "";
  return Object.values(parsed.fieldErrors).flat().find(Boolean) ?? "";
}

test("a fully filled draft passes validation", () => {
  assert.deepEqual(safeValidate(saveDraftSchema, valid), { success: true, data: valid });
});

test("an empty subject or body is a valid thing to save, unlike sending", () => {
  assert.equal(firstError({ ...valid, subject: "" }), "");
  assert.equal(firstError({ ...valid, body: "" }), "");
  assert.equal(firstError({ ...valid, subject: "", body: "" }), "");
});

test("no recipient or approval field is required, unlike sending", () => {
  const { organisationId, messageId, subject, body } = valid;
  assert.deepEqual(safeValidate(saveDraftSchema, { organisationId, messageId, subject, body }), {
    success: true,
    data: valid,
  });
});

test("the recipient is saved verbatim without send-time format rules (F119 AC1)", () => {
  // A work-in-progress address — half-typed, or deliberately overridden to
  // something unusual — is a valid thing to save; validation happens at send.
  for (const recipient of ["", "  client@example.org  ", "half-typed@", "client@"]) {
    assert.equal(firstError({ ...valid, recipient }), "", `recipient=${JSON.stringify(recipient)} should pass`);
  }
  assert.notEqual(firstError({ ...valid, recipient: "x".repeat(321) }), "");
});

test("malformed identifiers are refused", () => {
  for (const field of ["organisationId", "messageId"] as const) {
    assert.match(firstError({ ...valid, [field]: "not-a-uuid" }), /invalid/i);
  }
});

test("an overlong subject or body is refused", () => {
  assert.notEqual(firstError({ ...valid, subject: "x".repeat(999) }), "");
  assert.notEqual(firstError({ ...valid, body: "x".repeat(200_001) }), "");
});
