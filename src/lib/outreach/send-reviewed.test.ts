import assert from "node:assert/strict";
import test from "node:test";
import { safeValidate } from "../validation.ts";
import { reviewedEmailSchema } from "./send-reviewed.ts";

const valid = {
  organisationId: "00000000-0000-4000-a000-000000000001",
  messageId: "00000000-0000-4000-a000-000000000002",
  recipient: "client@example.org",
  subject: "Hello",
  body: "<p>Reviewed body text</p>",
  explicitlyApproved: true,
};

function firstError(input: unknown): string {
  const parsed = safeValidate(reviewedEmailSchema, input);
  if (parsed.success) return "";
  return Object.values(parsed.fieldErrors).flat().find(Boolean) ?? "";
}

test("a fully reviewed and approved email passes validation", () => {
  assert.deepEqual(safeValidate(reviewedEmailSchema, valid), { success: true, data: valid });
});

test("sending without explicit approval is refused", () => {
  for (const explicitlyApproved of [false, undefined, "yes"]) {
    const message = firstError({ ...valid, explicitlyApproved });
    assert.match(message, /approval/i, `explicitlyApproved=${String(explicitlyApproved)} should name approval`);
  }
});

test("blank or missing subject/body are refused before anything can be sent", () => {
  for (const field of ["subject", "body"] as const) {
    for (const value of ["", "   ", undefined]) {
      assert.notEqual(firstError({ ...valid, [field]: value }), "", `${field}=${JSON.stringify(value)} should fail`);
    }
  }
});

test("a missing or malformed recipient is refused before anything can be sent", () => {
  for (const recipient of ["", "   ", undefined, "not-an-email", "client@"]) {
    assert.notEqual(firstError({ ...valid, recipient }), "", `recipient=${JSON.stringify(recipient)} should fail`);
  }
});

test("a formatted but visually empty body is refused, not just a blank string", () => {
  // These are exactly what Tiptap's own empty document looks like, not a
  // hand-picked edge case — this is the shape validation actually has to
  // catch when a CAM clears the editor.
  for (const body of ["<p></p>", "<p><br></p>"]) {
    assert.notEqual(firstError({ ...valid, body }), "", `body=${JSON.stringify(body)} should fail`);
  }
});

test("malformed identifiers are refused", () => {
  for (const field of ["organisationId", "messageId"] as const) {
    assert.match(firstError({ ...valid, [field]: "not-a-uuid" }, ), /invalid/i);
  }
});
