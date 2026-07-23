import assert from "node:assert/strict";
import test from "node:test";
import {
  emailSchema,
  isExpiredOrUsedCode,
  isSafeInternalPath,
  passwordSchema,
  RESET_REQUEST_MESSAGE,
} from "./password-reset.ts";

test("request response is account-neutral", () => {
  assert.equal(
    RESET_REQUEST_MESSAGE,
    "If an account exists for that email, we’ve sent password reset instructions.",
  );
});

test("validates and normalises email without exposing account state", () => {
  assert.equal(emailSchema.parse(" User@180dc.org "), "user@180dc.org");
  assert.equal(emailSchema.safeParse("not-an-email").success, false);
});

test("rejects weak passwords and accepts a strong password", () => {
  assert.equal(passwordSchema.safeParse("short").success, false);
  assert.equal(passwordSchema.safeParse("alllowercase123").success, false);
  assert.equal(passwordSchema.safeParse("A-secure-password-123").success, true);
});

test("classifies expired and consumed recovery codes", () => {
  assert.equal(isExpiredOrUsedCode("otp_expired"), true);
  assert.equal(isExpiredOrUsedCode("flow_state_not_found"), true);
  assert.equal(isExpiredOrUsedCode("unexpected_failure"), false);
});

test("only accepts local redirect paths", () => {
  assert.equal(isSafeInternalPath("/reset-password"), true);
  assert.equal(isSafeInternalPath("//attacker.example"), false);
  assert.equal(isSafeInternalPath("https://attacker.example"), false);
});
