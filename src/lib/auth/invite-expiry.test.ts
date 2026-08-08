import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { INVITE_EXPIRY_HOURS, inviteExpiresAt, isInviteExpired } from "./invite-expiry.ts";

describe("inviteExpiresAt", () => {
  it("adds the expiry window to the invited time", () => {
    const invitedAt = new Date("2026-08-08T00:00:00.000Z");
    assert.equal(
      inviteExpiresAt(invitedAt, 24).toISOString(),
      "2026-08-09T00:00:00.000Z",
    );
  });

  it("accepts a string timestamp, the shape Postgres actually returns", () => {
    assert.equal(
      inviteExpiresAt("2026-08-08T00:00:00.000Z", 24).toISOString(),
      "2026-08-09T00:00:00.000Z",
    );
  });

  it("defaults to INVITE_EXPIRY_HOURS", () => {
    const invitedAt = new Date("2026-08-08T00:00:00.000Z");
    assert.equal(
      inviteExpiresAt(invitedAt).getTime(),
      invitedAt.getTime() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000,
    );
  });
});

describe("isInviteExpired", () => {
  const invitedAt = "2026-08-08T00:00:00.000Z";

  it("is not expired the moment it is sent", () => {
    assert.equal(isInviteExpired(invitedAt, 24, new Date(invitedAt)), false);
  });

  it("is not expired an hour before the window closes", () => {
    assert.equal(
      isInviteExpired(invitedAt, 24, new Date("2026-08-08T23:00:00.000Z")),
      false,
    );
  });

  it("is expired the instant the window closes", () => {
    assert.equal(
      isInviteExpired(invitedAt, 24, new Date("2026-08-09T00:00:00.000Z")),
      true,
    );
  });

  it("is expired well past the window", () => {
    assert.equal(
      isInviteExpired(invitedAt, 24, new Date("2026-08-15T00:00:00.000Z")),
      true,
    );
  });

  it("uses INVITE_EXPIRY_HOURS by default", () => {
    const justExpired = new Date(
      new Date(invitedAt).getTime() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000 + 1,
    );
    assert.equal(isInviteExpired(invitedAt, undefined, justExpired), true);
  });
});
