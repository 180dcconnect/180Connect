import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isAllowedRecipient,
  maskAddress,
  normaliseMessage,
  parseAllowlist,
  partitionRecipients,
} from "./message.ts";

const valid = {
  to: "ben@180dc.org",
  subject: "You have been invited to 180 Connect",
  text: "Follow the link to set your password.",
};

describe("normaliseMessage", () => {
  it("wraps a single recipient into a list and lowercases it", () => {
    const result = normaliseMessage({ ...valid, to: "Ben@180DC.org" });
    assert.ok(result.ok);
    assert.deepEqual(result.message.to, ["ben@180dc.org"]);
  });

  it("removes duplicate recipients so nobody is emailed twice", () => {
    const result = normaliseMessage({
      ...valid,
      to: ["ben@180dc.org", "BEN@180dc.org", "mo@180dc.org"],
    });
    assert.ok(result.ok);
    assert.deepEqual(result.message.to, ["ben@180dc.org", "mo@180dc.org"]);
  });

  it("collapses newlines in the subject, which is how header injection starts", () => {
    const result = normaliseMessage({
      ...valid,
      subject: "Invite\nBcc: attacker@example.com",
    });
    assert.ok(result.ok);
    assert.equal(result.message.subject, "Invite Bcc: attacker@example.com");
    assert.doesNotMatch(result.message.subject, /\n/);
  });

  it("rejects an invalid recipient", () => {
    const result = normaliseMessage({ ...valid, to: "not-an-address" });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.problems.length > 0);
  });

  it("rejects an empty subject", () => {
    const result = normaliseMessage({ ...valid, subject: "   " });
    assert.equal(result.ok, false);
  });

  it("rejects a message with no plain-text body", () => {
    const result = normaliseMessage({ ...valid, text: "" });
    assert.equal(result.ok, false);
  });

  it("rejects an empty recipient list", () => {
    const result = normaliseMessage({ ...valid, to: [] });
    assert.equal(result.ok, false);
  });
});

describe("parseAllowlist", () => {
  it("returns an empty list when unset", () => {
    assert.deepEqual(parseAllowlist(undefined), []);
    assert.deepEqual(parseAllowlist("  "), []);
  });

  it("trims, lowercases, and strips a leading @ from domains", () => {
    assert.deepEqual(parseAllowlist(" @180DC.org , Ben@180dc.org "), [
      "180dc.org",
      "ben@180dc.org",
    ]);
  });
});

describe("isAllowedRecipient", () => {
  const allowlist = parseAllowlist("180dc.org, mo@example.com");

  it("matches on domain", () => {
    assert.equal(isAllowedRecipient("anyone@180dc.org", allowlist), true);
  });

  it("matches on full address", () => {
    assert.equal(isAllowedRecipient("mo@example.com", allowlist), true);
  });

  it("does not match another address on an allowed address's domain", () => {
    assert.equal(isAllowedRecipient("someone-else@example.com", allowlist), false);
  });

  it("rejects an unrelated recipient", () => {
    assert.equal(isAllowedRecipient("trustee@a-real-charity.org.uk", allowlist), false);
  });
});

describe("partitionRecipients", () => {
  it("allows everyone when the allowlist is empty — the production case", () => {
    const to = ["trustee@a-real-charity.org.uk"];
    assert.deepEqual(partitionRecipients(to, []), { allowed: to, blocked: [] });
  });

  it("splits allowed from blocked", () => {
    const { allowed, blocked } = partitionRecipients(
      ["ben@180dc.org", "trustee@a-real-charity.org.uk"],
      parseAllowlist("180dc.org"),
    );
    assert.deepEqual(allowed, ["ben@180dc.org"]);
    assert.deepEqual(blocked, ["trustee@a-real-charity.org.uk"]);
  });
});

describe("maskAddress", () => {
  it("keeps the domain readable but not the person", () => {
    assert.equal(maskAddress("jane.doe@180dc.org"), "j***@180dc.org");
  });
});
