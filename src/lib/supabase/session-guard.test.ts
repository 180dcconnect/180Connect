import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
// `next/server` has no extensionless resolution outside the bundler, hence the
// explicit .js — this is the one place the tests touch real Next objects, so
// the cookie handling below is verified against the real implementation.
import { NextResponse } from "next/server.js";

import {
  RECOVERY_COOKIE_NAME,
  signRecoveryMarker,
} from "../auth/password-reset.ts";
import {
  ACTIVITY_COOKIE_NAME,
  INACTIVITY_TIMEOUT_MS,
  signActivity,
} from "./session-expiry.ts";
import {
  carryCookiesToRedirect,
  decideSessionAction,
  isBackgroundRequest,
  type GuardClient,
  type GuardRequest,
} from "./session-guard.ts";

// Signing is what stops a replayed session forging a fresh window, so the
// tests run the configured-secret path. Set before any code reads it; the test
// runner gives each file its own process, so this affects nothing else.
const SECRET = "test-secret-at-least-32-characters-long!!";
process.env.SESSION_ACTIVITY_SECRET = SECRET;

const USER = { id: "11111111-1111-4111-8111-111111111111" };

function makeRequest({
  pathname = "/dashboard",
  headers = {},
  activity,
  recovery,
}: {
  pathname?: string;
  headers?: Record<string, string>;
  activity?: string;
  recovery?: string;
} = {}): GuardRequest {
  const jar: Record<string, string | undefined> = {
    [ACTIVITY_COOKIE_NAME]: activity,
    [RECOVERY_COOKIE_NAME]: recovery,
  };
  return {
    pathname,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    cookies: {
      get: (name) => (jar[name] === undefined ? undefined : { value: jar[name] }),
    },
  };
}

function makeClient({
  user = USER as { id: string } | null,
  signOutError = null as { message: string } | null,
}: { user?: { id: string } | null; signOutError?: { message: string } | null } = {}) {
  const signOut = mock.fn(async () => ({ error: signOutError }));
  const client: GuardClient = {
    auth: {
      getUser: async () => ({ data: { user } }),
      signOut,
    },
  };
  return { client, signOut };
}

/** A record from `staleMinutes` ago, signed the way the proxy would have. */
function activityAgedBy(ms: number, now: number) {
  return signActivity(now - ms, SECRET);
}

describe("decideSessionAction", () => {
  beforeEach(() => {
    // Expiry logs through logSecurityEvent, which writes to console.error.
    mock.method(console, "error", () => {});
  });

  it("leaves a logged-out visitor alone", async () => {
    const { client, signOut } = makeClient({ user: null });
    const outcome = await decideSessionAction(makeRequest(), client);

    assert.deepEqual(outcome, { action: "pass", reason: "signed-out" });
    assert.equal(signOut.mock.callCount(), 0);
  });

  it("never expires a request for /login, which is where expiry sends people", async () => {
    // Without this guard a sign-out that failed to clear cookies would bounce
    // the user between /login and /login for ever.
    const { client, signOut } = makeClient();
    const outcome = await decideSessionAction(
      makeRequest({ pathname: "/login", activity: undefined }),
      client,
    );

    assert.deepEqual(outcome, { action: "pass", reason: "auth-route" });
    assert.equal(signOut.mock.callCount(), 0);
  });

  // A recovery link necessarily mints a real session — it is the only way
  // `updateUser` can set a password — so these two decide whether that session
  // is a password reset or a free pass into the app.
  describe("a session mid password reset (F004)", () => {
    it("is confined to the reset flow rather than let into the app", async () => {
      const { client, signOut } = makeClient();
      const outcome = await decideSessionAction(
        makeRequest({
          pathname: "/dashboard",
          recovery: await signRecoveryMarker(USER.id, SECRET),
        }),
        client,
      );

      assert.deepEqual(outcome, { action: "confine", redirectTo: "/reset-password" });
      // Confined, not signed out: the reset still has to be completable.
      assert.equal(signOut.mock.callCount(), 0);
    });

    it("reaches the reset page and the ways out of it", async () => {
      const recovery = await signRecoveryMarker(USER.id, SECRET);
      for (const pathname of ["/reset-password", "/forgot-password", "/login"]) {
        const { client } = makeClient();
        const outcome = await decideSessionAction(
          makeRequest({ pathname, recovery }),
          client,
        );
        assert.deepEqual(outcome, { action: "pass", reason: "recovery" }, pathname);
      }
    });

    // It never passed through the login action, so it has no activity record,
    // and expiry fails closed. Without the recovery branch it would be signed
    // out on its very first request and the reset could never complete.
    it("is not expired for having no activity record", async () => {
      const { client, signOut } = makeClient();
      const outcome = await decideSessionAction(
        makeRequest({
          pathname: "/reset-password",
          activity: undefined,
          recovery: await signRecoveryMarker(USER.id, SECRET),
        }),
        client,
      );

      assert.equal(outcome.action, "pass");
      assert.equal(signOut.mock.callCount(), 0);
    });

    it("ignores a marker that names someone else", async () => {
      const { client } = makeClient();
      const outcome = await decideSessionAction(
        makeRequest({
          pathname: "/dashboard",
          activity: await activityAgedBy(0, Date.now()),
          recovery: await signRecoveryMarker(
            "99999999-9999-4999-8999-999999999999",
            SECRET,
          ),
        }),
        client,
      );

      assert.equal(outcome.action, "refresh");
    });

    // Forged and unsigned markers are rejected by `readRecoveryMarker`, which
    // owns that decision and is tested against it directly in
    // `src/lib/auth/password-reset.test.ts`.
  });

  it("refreshes the window for an active user", async () => {
    const now = Date.now();
    const { client } = makeClient();
    const outcome = await decideSessionAction(
      makeRequest({ activity: await activityAgedBy(60_000, now) }),
      client,
      now,
    );

    assert.equal(outcome.action, "refresh");
    assert.equal(outcome.action === "refresh" && outcome.cookie.name, ACTIVITY_COOKIE_NAME);
    assert.equal(
      outcome.action === "refresh" && outcome.cookie.value,
      await signActivity(now, SECRET),
    );
    assert.equal(outcome.action === "refresh" && outcome.cookie.options.httpOnly, true);
  });

  it("expires a session that has sat idle past the timeout", async () => {
    const now = Date.now();
    const { client, signOut } = makeClient();
    const outcome = await decideSessionAction(
      makeRequest({ activity: await activityAgedBy(INACTIVITY_TIMEOUT_MS + 1, now) }),
      client,
      now,
    );

    assert.equal(outcome.action, "expire");
    assert.equal(
      outcome.action === "expire" && outcome.redirectTo,
      "/login?signed_out=expired",
    );
    assert.equal(outcome.action === "expire" && outcome.signedOut, true);
    // Revoking server-side is what stops the token being replayed.
    assert.equal(signOut.mock.callCount(), 1);
  });

  it("expires a session that arrives with no activity record", async () => {
    // Fails closed: a replayed session in another browser has no such cookie,
    // and must not thereby become immune to the timeout.
    const { client, signOut } = makeClient();
    const outcome = await decideSessionAction(makeRequest(), client);

    assert.equal(outcome.action, "expire");
    assert.equal(signOut.mock.callCount(), 1);
  });

  it("expires a session whose activity record has been tampered with", async () => {
    const now = Date.now();
    const { client } = makeClient();

    // A stolen window re-dated to now, a made-up signature, and junk.
    const stale = await signActivity(now - INACTIVITY_TIMEOUT_MS * 2, SECRET);
    const stolenSignature = stale.slice(stale.indexOf(".") + 1);

    for (const forged of [
      String(now),
      `${now}.not-a-real-signature`,
      `${now}.${stolenSignature}`,
      "garbage",
    ]) {
      const outcome = await decideSessionAction(
        makeRequest({ activity: forged }),
        client,
        now,
      );
      assert.equal(outcome.action, "expire", `expected ${forged} to expire the session`);
    }
  });

  it("falls back to unsigned records when no secret is configured", async () => {
    // Without SESSION_ACTIVITY_SECRET sessions must still expire — the app has
    // to work before the secret is set, it just cannot resist a forged record.
    const now = Date.now();
    const { client } = makeClient();
    delete process.env.SESSION_ACTIVITY_SECRET;

    try {
      const fresh = await decideSessionAction(
        makeRequest({ activity: String(now - 60_000) }),
        client,
        now,
      );
      assert.equal(fresh.action, "refresh");

      const stale = await decideSessionAction(
        makeRequest({ activity: String(now - INACTIVITY_TIMEOUT_MS - 1) }),
        client,
        now,
      );
      assert.equal(stale.action, "expire");
    } finally {
      process.env.SESSION_ACTIVITY_SECRET = SECRET;
    }
  });

  it("expires a session dated in the future", async () => {
    const now = Date.now();
    const { client } = makeClient();
    const outcome = await decideSessionAction(
      makeRequest({ activity: await signActivity(now + 60 * 60 * 1000, SECRET) }),
      client,
      now,
    );

    assert.equal(outcome.action, "expire");
  });

  it("still expires when Supabase reports the sign-out failed", async () => {
    // A failed sign-out must not leave the user on an authenticated page.
    const { client } = makeClient({ signOutError: { message: "network down" } });
    const outcome = await decideSessionAction(makeRequest(), client);

    assert.equal(outcome.action, "expire");
    assert.equal(outcome.action === "expire" && outcome.signedOut, false);
  });

  it("does not let a prefetch renew the window", async () => {
    // An abandoned tab keeps prefetching; if that counted as activity the
    // session would never time out.
    const now = Date.now();
    const { client } = makeClient();

    const backgroundHeaders: Record<string, string>[] = [
      { "sec-purpose": "prefetch" },
      { "sec-purpose": "prefetch;anonymous-client-ip" },
      { purpose: "prefetch" },
      { "x-purpose": "preview" },
      { "next-router-prefetch": "1" },
    ];

    for (const headers of backgroundHeaders) {
      const outcome = await decideSessionAction(
        makeRequest({ headers, activity: await activityAgedBy(60_000, now) }),
        client,
        now,
      );
      assert.deepEqual(outcome, { action: "pass", reason: "background" });
    }
  });

  it("still expires a stale session on a prefetch", async () => {
    // Not renewing is not the same as ignoring: stale is stale whoever asked.
    const now = Date.now();
    const { client, signOut } = makeClient();
    const outcome = await decideSessionAction(
      makeRequest({
        headers: { "next-router-prefetch": "1" },
        activity: await activityAgedBy(INACTIVITY_TIMEOUT_MS + 1, now),
      }),
      client,
      now,
    );

    assert.equal(outcome.action, "expire");
    assert.equal(signOut.mock.callCount(), 1);
  });
});

describe("isBackgroundRequest", () => {
  it("treats an ordinary navigation as user activity", () => {
    assert.equal(isBackgroundRequest(makeRequest()), false);
  });
});

describe("carryCookiesToRedirect", () => {
  it("moves the sign-out cookie deletions onto the redirect", () => {
    // The bug this covers: the redirect was a fresh response, so the cleared
    // Supabase cookies never reached the browser and the session survived.
    const signedOutResponse = NextResponse.next();
    signedOutResponse.cookies.set("sb-access-token", "", { maxAge: 0, path: "/" });
    signedOutResponse.cookies.set("sb-refresh-token", "", { maxAge: 0, path: "/" });

    const redirect = NextResponse.redirect(new URL("http://localhost/login"));
    carryCookiesToRedirect(signedOutResponse, redirect);

    const carried = redirect.cookies.getAll();
    for (const name of ["sb-access-token", "sb-refresh-token"]) {
      const cookie = carried.find((c) => c.name === name);
      assert.ok(cookie, `${name} should have been carried onto the redirect`);
      assert.equal(cookie.value, "");
      assert.equal(cookie.maxAge, 0);
    }
  });

  it("drops the activity cookie rather than carrying it", () => {
    const from = NextResponse.next();
    from.cookies.set(ACTIVITY_COOKIE_NAME, "123456", { path: "/" });

    const redirect = NextResponse.redirect(new URL("http://localhost/login"));
    carryCookiesToRedirect(from, redirect);

    // Present only as a deletion — an expired session has no window to record.
    const activity = redirect.cookies.get(ACTIVITY_COOKIE_NAME);
    assert.equal(activity?.value, "");
    assert.equal(activity?.expires?.valueOf(), 0);
    assert.match(redirect.headers.get("set-cookie") ?? "", /last_activity=;/);
  });
});
