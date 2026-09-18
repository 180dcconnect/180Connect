import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkSuppressionBeforeSend, suppressionBlockedMessage } from "./suppression-check.ts";

describe("F249 suppression check before send", () => {
  it("allows outreach when a fresh lookup finds no active suppression", async () => {
    assert.deepEqual(await checkSuppressionBeforeSend("org-1", async () => null), { allowed: true });
  });

  it("blocks a suppressed client and returns the recorded reason", async () => {
    assert.deepEqual(
      await checkSuppressionBeforeSend("org-1", async () => ({ id: "s-1", reason: "Legal request" })),
      { allowed: false, kind: "suppressed", suppressionId: "s-1", reason: "Legal request" },
    );
  });

  it("checks current state on every attempted action", async () => {
    let suppressed = false;
    const lookup = async () => suppressed ? { id: "s-1", reason: "Hard no" } : null;
    assert.deepEqual(await checkSuppressionBeforeSend("org-1", lookup), { allowed: true });
    suppressed = true;
    const second = await checkSuppressionBeforeSend("org-1", lookup);
    assert.equal(second.allowed, false);
    if (!second.allowed && second.kind === "suppressed") assert.equal(second.reason, "Hard no");
  });

  it("fails closed when suppression state cannot be read", async () => {
    const result = await checkSuppressionBeforeSend("org-1", async () => {
      throw new Error("database unavailable");
    });
    assert.deepEqual(result, { allowed: false, kind: "unavailable" });
  });

  it("does not provide an admin override because active suppression blocks every role", async () => {
    const result = await checkSuppressionBeforeSend("org-1", async () => ({
      id: "s-1",
      reason: "Do not contact",
    }));
    assert.equal(result.allowed, false);
  });

  it("builds a clear warning without exposing internal details", () => {
    assert.equal(
      suppressionBlockedMessage("Legal request"),
      "This client is suppressed. Outreach is blocked. Reason: Legal request",
    );
  });
});
