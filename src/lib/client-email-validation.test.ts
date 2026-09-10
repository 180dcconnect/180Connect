import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canSendClientOutreach,
  onFileEmail,
  REDACTED_EMAIL_MESSAGE,
  validateClientEmail,
} from "./client-email-validation.ts";
import { REDACTED_EMAIL } from "./ingestion/personal-data.ts";

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

  it("reports a redacted address as its own state, not as a malformed value", () => {
    assert.deepEqual(validateClientEmail(REDACTED_EMAIL), {
      status: "redacted",
      value: null,
      message: REDACTED_EMAIL_MESSAGE,
    });
  });

  it("never returns the placeholder as a value a caller could render or send", () => {
    // The whole point of `value: null` on this branch: nothing downstream can
    // print `[redacted:personal-email]` at a CAM or hand it to a transport.
    assert.equal(validateClientEmail(REDACTED_EMAIL).value, null);
  });

  it("catches a placeholder embedded in a longer value, not only a bare one", () => {
    // Redaction is in place, so a scraped field arrives as surrounding text with
    // the placeholder sitting inside it.
    const result = validateClientEmail(`Contact ${REDACTED_EMAIL} for details`);
    assert.equal(result.status, "redacted");
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

describe("onFileEmail", () => {
  it("returns the trimmed address when there is one to write to", () => {
    assert.equal(onFileEmail("  info@example.org "), "info@example.org");
  });

  it("returns null for a redacted address, so nothing offers it as a recipient", () => {
    assert.equal(onFileEmail(REDACTED_EMAIL), null);
  });

  it("returns null for a blank or absent address", () => {
    assert.equal(onFileEmail("   "), null);
    assert.equal(onFileEmail(null), null);
  });

  it("keeps a malformed address — a value someone typed is still a recipient to warn about", () => {
    assert.equal(onFileEmail("not-an-email"), "not-an-email");
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

  it("blocks a redacted recipient and explains why rather than calling it invalid", () => {
    assert.deepEqual(canSendClientOutreach(REDACTED_EMAIL, true), {
      allowed: false,
      warning: REDACTED_EMAIL_MESSAGE,
    });
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
