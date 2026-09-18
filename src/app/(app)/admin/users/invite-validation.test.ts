import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_BULK_RECIPIENTS,
  validateInviteEmail,
  validateInviteName,
} from "./invite-validation.ts";

const DOMAINS = ["180dc.org"];

describe("validateInviteEmail", () => {
  it("accepts an address on the allowed domain", () => {
    assert.equal(validateInviteEmail("ada@180dc.org", DOMAINS), null);
  });

  it("accepts a plus-addressed local part", () => {
    assert.equal(validateInviteEmail("ada+ben@180dc.org", DOMAINS), null);
  });

  it("trims and lowercases before deciding", () => {
    assert.equal(validateInviteEmail("  Ada@180DC.org ", DOMAINS), null);
  });

  it("refuses an address off the allowed domain", () => {
    assert.match(
      validateInviteEmail("ada@gmail.com", DOMAINS) ?? "",
      /@180dc\.org/,
    );
  });

  it("refuses the two-at shape a suffix check accepts", () => {
    // `endsWith("@180dc.org")` returns true for this.
    assert.equal(
      validateInviteEmail("attacker@evil.com@180dc.org", DOMAINS),
      "Enter a valid email address.",
    );
  });

  it("refuses a subdomain of an allowed domain", () => {
    assert.notEqual(validateInviteEmail("ada@mail.180dc.org", DOMAINS), null);
  });

  it("refuses an empty address", () => {
    assert.equal(validateInviteEmail("   ", DOMAINS), "Enter an email address.");
  });

  it("refuses an address containing a space", () => {
    assert.equal(
      validateInviteEmail("ada smith@180dc.org", DOMAINS),
      "An email address cannot contain spaces.",
    );
  });

  it("refuses an empty local part", () => {
    assert.equal(validateInviteEmail("@180dc.org", DOMAINS), "Enter a valid email address.");
  });

  it("refuses a domain with no dot", () => {
    assert.equal(validateInviteEmail("ada@180dc", DOMAINS), "Enter a valid email address.");
  });

  it("refuses consecutive or trailing dots in the domain", () => {
    assert.equal(validateInviteEmail("ada@180dc..org", DOMAINS), "Enter a valid email address.");
    assert.equal(validateInviteEmail("ada@180dc.org.", DOMAINS), "Enter a valid email address.");
  });

  it("refuses an over-long local part", () => {
    const local = "a".repeat(65);
    assert.equal(
      validateInviteEmail(`${local}@180dc.org`, DOMAINS),
      "That email address is too long.",
    );
  });

  it("refuses an address over 254 characters", () => {
    const long = `${"a".repeat(60)}@${"b".repeat(200)}.org`;
    assert.equal(validateInviteEmail(long, DOMAINS), "That email address is too long.");
  });

  it("honours a multi-domain allowlist", () => {
    const domains = ["180dc.org", "example.com"];
    assert.equal(validateInviteEmail("ada@example.com", domains), null);
    assert.match(validateInviteEmail("ada@other.com", domains) ?? "", /or @example\.com/);
  });
});

describe("validateInviteName", () => {
  it("accepts a normal name", () => {
    assert.equal(validateInviteName("Ada Lovelace"), null);
  });

  it("refuses an empty or whitespace-only name", () => {
    assert.equal(validateInviteName(""), "Enter their full name.");
    assert.equal(validateInviteName("   "), "Enter their full name.");
  });

  it("refuses a name past the schema's 120-character cap", () => {
    assert.match(validateInviteName("a".repeat(121)) ?? "", /under 120/);
    assert.equal(validateInviteName("a".repeat(120)), null);
  });
});

describe("MAX_BULK_RECIPIENTS", () => {
  it("is a sane batch cap", () => {
    assert.ok(MAX_BULK_RECIPIENTS > 0 && MAX_BULK_RECIPIENTS <= 100);
  });
});
