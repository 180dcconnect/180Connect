import assert from "node:assert/strict";
import test from "node:test";
import { safeValidate } from "../validation.ts";
import { discardDraftSchema } from "./discard-draft.ts";

const valid = {
  organisationId: "00000000-0000-4000-a000-000000000001",
  messageId: "00000000-0000-4000-a000-000000000002",
};

function firstError(input: unknown): string {
  const parsed = safeValidate(discardDraftSchema, input);
  if (parsed.success) return "";
  return Object.values(parsed.fieldErrors).flat().find(Boolean) ?? "";
}

test("a valid organisation and message id passes validation", () => {
  assert.deepEqual(safeValidate(discardDraftSchema, valid), { success: true, data: valid });
});

test("malformed identifiers are refused", () => {
  for (const field of ["organisationId", "messageId"] as const) {
    assert.match(firstError({ ...valid, [field]: "not-a-uuid" }), /invalid/i);
  }
});

test("missing identifiers are refused", () => {
  assert.notEqual(firstError({ organisationId: valid.organisationId }), "");
  assert.notEqual(firstError({ messageId: valid.messageId }), "");
});
