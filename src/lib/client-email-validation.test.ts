import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canSendClientOutreach,
  validateClientEmail,
} from "./client-email-validation.ts";

describe("validateClientEmail", () => {
  it("accepts and normalises a valid email", () => {
    assert.deepEqual(validateClientEmail(" Charity@Example.ORG "), {
      status: "valid",
      value: "charity@example.org",
      message: null,
    });
  });

  it("flags an invalid imported or manually entered value without throwing", () => {
    assert.deepEqual(validateClientEmail("not-an-email"), {
      status: "invalid",
      value: "not-an-email",
      message: "This email address has an invalid format. Correct it before outreach.",
    });
  });

  it("distinguishes a missing optional email from a malformed one", () => {
    assert.equal(validateClientEmail(null).status, "missing");
    assert.equal(validateClientEmail("   ").status, "missing");
  });

  it("applies the same result to duplicate formatting variants", () => {
    const first = validateClientEmail("hello@example.org");
    const duplicate = validateClientEmail(" HELLO@EXAMPLE.ORG ");
    assert.equal(first.status, "valid");
    assert.equal(duplicate.status, "valid");
    assert.equal(first.value, duplicate.value);
  });

  it("does not change a conflicting or invalid source value", () => {
    const result = validateClientEmail("first@example.org;second@example.org");
    assert.equal(result.status, "invalid");
    assert.equal(result.value, "first@example.org;second@example.org");
  });
});

describe("canSendClientOutreach", () => {
  it("blocks an invalid recipient and returns a visible warning", () => {
    assert.deepEqual(canSendClientOutreach("broken@", true), {
      allowed: false,
      warning: "This email address has an invalid format. Correct it before outreach.",
    });
  });

  it("blocks a missing recipient", () => {
    assert.equal(canSendClientOutreach(null, true).allowed, false);
  });

  it("blocks a valid recipient until a human explicitly approves it", () => {
    assert.deepEqual(canSendClientOutreach("hello@example.org", false), {
      allowed: false,
      warning: "Review and explicitly approve the recipient before sending outreach.",
    });
  });

  it("allows only a valid, explicitly approved recipient", () => {
    assert.deepEqual(canSendClientOutreach(" HELLO@EXAMPLE.ORG ", true), {
      allowed: true,
      recipient: "hello@example.org",
    });
  });
});
