import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACTIVITY_COOKIE_NAME,
  INACTIVITY_TIMEOUT_MS,
  activityCookieOptions,
  activitySecret,
  isSessionExpired,
  readActivity,
  signActivity,
} from "./session-expiry.ts";

const SECRET = "test-secret-at-least-32-characters-long!!";

describe("isSessionExpired", () => {
  it("is not expired when last activity is within the timeout window", () => {
    const now = Date.now();
    assert.equal(
      isSessionExpired(now - 5 * 60 * 1000, now, INACTIVITY_TIMEOUT_MS),
      false,
    );
  });

  it("is expired when last activity is beyond the timeout window", () => {
    const now = Date.now();
    assert.equal(
      isSessionExpired(now - 40 * 60 * 1000, now, INACTIVITY_TIMEOUT_MS),
      true,
    );
  });

  it("is expired exactly at the timeout boundary", () => {
    const now = Date.now();
    assert.equal(
      isSessionExpired(now - INACTIVITY_TIMEOUT_MS, now, INACTIVITY_TIMEOUT_MS),
      true,
    );
    assert.equal(
      isSessionExpired(now - INACTIVITY_TIMEOUT_MS + 1, now, INACTIVITY_TIMEOUT_MS),
      false,
    );
  });

  it("expires when there is no usable record", () => {
    // Fails closed. A missing record is exactly what a session replayed in
    // another browser looks like, so it must never read as "still fresh".
    const now = Date.now();
    assert.equal(isSessionExpired(null, now, INACTIVITY_TIMEOUT_MS), true);
    assert.equal(isSessionExpired(Number.NaN, now, INACTIVITY_TIMEOUT_MS), true);
  });

  it("expires a record dated implausibly far in the future", () => {
    const now = Date.now();
    assert.equal(
      isSessionExpired(now + 60 * 60 * 1000, now, INACTIVITY_TIMEOUT_MS),
      true,
    );
  });

  it("tolerates small clock drift between regions", () => {
    const now = Date.now();
    assert.equal(isSessionExpired(now + 5_000, now, INACTIVITY_TIMEOUT_MS), false);
  });

  it("respects a custom timeout value", () => {
    const now = Date.now();
    assert.equal(isSessionExpired(now - 10 * 60 * 1000, now, 5 * 60 * 1000), true);
  });
});

describe("signActivity / readActivity", () => {
  it("round-trips a signed timestamp", async () => {
    const now = Date.now();
    const cookie = await signActivity(now, SECRET);
    assert.equal(await readActivity(cookie, SECRET), now);
  });

  it("rejects a forged timestamp", async () => {
    const now = Date.now();
    const stale = await signActivity(now - INACTIVITY_TIMEOUT_MS * 2, SECRET);
    const signature = stale.slice(stale.indexOf(".") + 1);

    // A replayed session buying itself a fresh window: keep the stolen
    // signature, move the timestamp forward.
    assert.equal(await readActivity(`${now}.${signature}`, SECRET), null);
  });

  it("rejects a value signed with a different secret", async () => {
    const cookie = await signActivity(Date.now(), "another-secret-entirely-32-chars!");
    assert.equal(await readActivity(cookie, SECRET), null);
  });

  it("rejects an unsigned value when a secret is configured", async () => {
    assert.equal(await readActivity(String(Date.now()), SECRET), null);
  });

  it("rejects absent and malformed values", async () => {
    for (const value of [undefined, "", "not-a-number", "12.34.56", "-1", "1e9"]) {
      assert.equal(
        await readActivity(value, SECRET),
        null,
        `expected ${value} to be rejected`,
      );
    }
  });

  it("accepts a bare timestamp when no secret is configured", async () => {
    const now = Date.now();
    assert.equal(await readActivity(String(now), null), now);
    // A signature left behind by a secret that has since been removed is ignored.
    assert.equal(await readActivity(`${now}.stale-signature`, null), now);
  });

  it("reads back as expired once the window has passed", async () => {
    const signedAt = Date.now() - INACTIVITY_TIMEOUT_MS - 1;
    const stored = await readActivity(await signActivity(signedAt, SECRET), SECRET);
    assert.equal(isSessionExpired(stored, Date.now()), true);
  });
});

describe("activitySecret", () => {
  it("reads the configured secret", () => {
    assert.equal(activitySecret({ SESSION_ACTIVITY_SECRET: SECRET }), SECRET);
  });

  it("treats blank or absent configuration as no secret", () => {
    assert.equal(activitySecret({}), null);
    assert.equal(activitySecret({ SESSION_ACTIVITY_SECRET: "   " }), null);
  });
});

describe("activityCookieOptions", () => {
  it("locks the cookie down and scopes it to the whole site", () => {
    const options = activityCookieOptions();
    assert.equal(ACTIVITY_COOKIE_NAME, "last_activity");
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, "lax");
    assert.equal(options.path, "/");
    // Never outlives the window it records.
    assert.equal(options.maxAge, INACTIVITY_TIMEOUT_MS / 1000);
  });
});
