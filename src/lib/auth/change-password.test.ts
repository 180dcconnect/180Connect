import assert from "node:assert/strict";
import { test } from "node:test";
import { changePasswordSchema, formString } from "./change-password.ts";
import { safeValidate } from "../validation.ts";

const VALID = {
  currentPassword: "Old-password-1",
  password: "Brand-new-password-2",
  confirmPassword: "Brand-new-password-2",
};

test("accepts a valid change", () => {
  const result = safeValidate(changePasswordSchema, VALID);
  assert.equal(result.success, true);
});

test("requires the current password", () => {
  const result = safeValidate(changePasswordSchema, { ...VALID, currentPassword: "" });
  assert.equal(result.success, false);
  assert.ok(!result.success && result.fieldErrors.currentPassword?.length);
});

test("holds the new password to the password rules", () => {
  const result = safeValidate(changePasswordSchema, {
    ...VALID,
    password: "short",
    confirmPassword: "short",
  });
  assert.equal(result.success, false);
  assert.ok(!result.success && result.fieldErrors.password?.length);
});

test("rejects a confirmation that does not match", () => {
  const result = safeValidate(changePasswordSchema, {
    ...VALID,
    confirmPassword: "Brand-new-password-3",
  });
  assert.equal(result.success, false);
  assert.deepEqual(!result.success && result.fieldErrors.confirmPassword, [
    "Passwords do not match.",
  ]);
});

test("rejects a new password identical to the current one", () => {
  const result = safeValidate(changePasswordSchema, {
    currentPassword: "Same-password-123",
    password: "Same-password-123",
    confirmPassword: "Same-password-123",
  });
  assert.equal(result.success, false);
  assert.ok(!result.success && result.fieldErrors.password?.length);
});

test("formString treats a missing entry as empty", () => {
  assert.equal(formString(null), "");
  assert.equal(formString("x"), "x");
});
