import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { User } from "@supabase/supabase-js";

import {
  allowedEmailDomain,
  allowedEmailDomains,
  describeDomains,
  isOnAllowedDomain,
  loginSchema,
  attemptLogin,
  DEFAULT_ALLOWED_EMAIL_DOMAIN,
  normalizeEmail,
  SERVICE_UNAVAILABLE_MESSAGE,
  SUSPENDED_MESSAGE,
  type LoginClient,
  type LoginInput,
  type LoginOutcome,
} from "./login.ts";
import type { LoginThrottle } from "./login-throttle.ts";

const VALID: LoginInput = {
  email: "ada@180dc.org",
  password: "correct-horse-battery-staple",
  captchaToken: "turnstile-token",
};

function makeUser(): User {
  return {
    id: "user-1",
    email: "ada@180dc.org",
    app_metadata: {},
  } as unknown as User;
}

type ClientCalls = {
  signIn: { email: string; password: string; captchaToken?: string }[];
  signOut: number;
};

/**
 * A fake Supabase client that records what it was called with. `behaviour`
 * decides what `signInWithPassword` does — return a user, return an error, or
 * throw, which is how a network failure surfaces.
 */
function fakeClient(
  behaviour:
    | { user: User }
    | { error: string }
    | { throws: Error },
): { client: LoginClient; calls: ClientCalls } {
  const calls: ClientCalls = { signIn: [], signOut: 0 };

  const client: LoginClient = {
    auth: {
      async signInWithPassword({ email, password, options }) {
        calls.signIn.push({ email, password, captchaToken: options?.captchaToken });
        if ("throws" in behaviour) throw behaviour.throws;
        if ("error" in behaviour) {
          return { data: { user: null }, error: { message: behaviour.error } };
        }
        return { data: { user: behaviour.user }, error: null };
      },
      async signOut() {
        calls.signOut += 1;
        return { error: null };
      },
    },
  };

  return { client, calls };
}

/** Runs `fn` with `logSecurityEvent`'s console.error captured. */
async function silencingLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const errorMock = mock.method(console, "error", () => {});
  try {
    const result = await fn();
    return {
      result,
      logs: errorMock.mock.calls.map((call) => JSON.stringify(call.arguments)),
    };
  } finally {
    errorMock.mock.restore();
  }
}

/** Narrows a rejected outcome, failing the test if the login unexpectedly succeeded. */
function rejected(outcome: LoginOutcome) {
  assert.equal(outcome.ok, false, "expected the login to be rejected");
  return (outcome as { ok: false; state: NonNullable<unknown> }).state as {
    status: string;
    message?: string;
    fieldErrors?: { email?: string[]; password?: string[] };
    email?: string;
  };
}

describe("allowedEmailDomain", () => {
  it("falls back to 180dc.org when unset", () => {
    assert.equal(allowedEmailDomain({}), DEFAULT_ALLOWED_EMAIL_DOMAIN);
  });

  it("normalises case, whitespace and a leading @", () => {
    assert.equal(allowedEmailDomain({ AUTH_ALLOWED_EMAIL_DOMAIN: "  @Example.ORG " }), "example.org");
  });

  it("names the first domain when several are configured", () => {
    assert.equal(
      allowedEmailDomain({ AUTH_ALLOWED_EMAIL_DOMAIN: "180dc.org,example.com" }),
      "180dc.org",
    );
  });
});

describe("allowedEmailDomains", () => {
  it("returns a single-entry list when one domain is configured", () => {
    assert.deepEqual(allowedEmailDomains({}), [DEFAULT_ALLOWED_EMAIL_DOMAIN]);
  });

  it("splits a comma-separated list, normalising each entry", () => {
    assert.deepEqual(
      allowedEmailDomains({ AUTH_ALLOWED_EMAIL_DOMAIN: "180dc.org, @Example.COM " }),
      ["180dc.org", "example.com"],
    );
  });

  it("falls back rather than permitting nothing when the value is empty", () => {
    // A login form that refuses every address is worse than one briefly too
    // strict — and Postgres is the layer that actually decides.
    assert.deepEqual(allowedEmailDomains({ AUTH_ALLOWED_EMAIL_DOMAIN: " , " }), [
      DEFAULT_ALLOWED_EMAIL_DOMAIN,
    ]);
  });
});

describe("isOnAllowedDomain", () => {
  it("accepts an address on any listed domain", () => {
    assert.equal(isOnAllowedDomain("a@example.com", ["180dc.org", "example.com"]), true);
  });

  it("rejects an address on none of them", () => {
    assert.equal(isOnAllowedDomain("a@evil.com", ["180dc.org"]), false);
  });

  it("matches the domain, not a suffix", () => {
    // `endsWith('@180dc.org')` — the old check — accepts this. It is not a
    // 180dc.org address.
    assert.equal(isOnAllowedDomain("attacker@evil.com@180dc.org", ["180dc.org"]), false);
  });

  it("does not treat a subdomain as the parent domain", () => {
    assert.equal(isOnAllowedDomain("a@mail.180dc.org", ["180dc.org"]), false);
  });

  it("accepts a plus-addressed alias, which is how one mailbox becomes many", () => {
    assert.equal(isOnAllowedDomain("bashir+ben@180dc.org", ["180dc.org"]), true);
  });
});

describe("describeDomains", () => {
  it("names one domain plainly", () => {
    assert.equal(describeDomains(["180dc.org"]), "@180dc.org");
  });

  it("joins several readably", () => {
    assert.equal(
      describeDomains(["180dc.org", "example.com"]),
      "@180dc.org or @example.com",
    );
  });
});

describe("loginSchema", () => {
  it("accepts either domain when two are permitted", () => {
    const schema = loginSchema(["180dc.org", "example.com"]);
    assert.ok(schema.safeParse({ email: "a@example.com", password: "x" }).success);
    assert.ok(schema.safeParse({ email: "a@180dc.org", password: "x" }).success);
  });

  it("still accepts a bare string, as every existing caller passes", () => {
    assert.ok(
      loginSchema("180dc.org").safeParse({ email: "a@180dc.org", password: "x" }).success,
    );
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    assert.equal(normalizeEmail("  Ada@180DC.org "), "ada@180dc.org");
  });

  it("turns missing input into an empty string rather than \"undefined\"", () => {
    assert.equal(normalizeEmail(undefined), "");
    assert.equal(normalizeEmail(null), "");
  });
});

describe("attemptLogin — validation", () => {
  it("rejects an email outside the allowed domain and never contacts Supabase", async () => {
    const { client, calls } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() =>
      attemptLogin(client, { ...VALID, email: "ada@gmail.com" }),
    );

    const state = rejected(result);
    assert.equal(state.status, "error");
    assert.match(state.fieldErrors?.email?.[0] ?? "", /@180dc\.org/);
    assert.deepEqual(calls.signIn, []);
  });

  it("honours a configured domain other than the default", async () => {
    const { client } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() =>
      attemptLogin(client, { ...VALID, email: "ada@example.org" }, "example.org"),
    );

    assert.equal(result.ok, true);
  });

  it("rejects a malformed email", async () => {
    const { client, calls } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() =>
      attemptLogin(client, { ...VALID, email: "not-an-email" }),
    );

    assert.equal(rejected(result).status, "error");
    assert.deepEqual(calls.signIn, []);
  });

  it("rejects an empty password", async () => {
    const { client, calls } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() => attemptLogin(client, { ...VALID, password: "" }));

    assert.equal(rejected(result).fieldErrors?.password?.[0], "Enter your password.");
    assert.deepEqual(calls.signIn, []);
  });

  it("rejects a missing password field rather than coercing it", async () => {
    const { client, calls } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() =>
      attemptLogin(client, { ...VALID, password: undefined }),
    );

    assert.equal(rejected(result).status, "error");
    assert.deepEqual(calls.signIn, []);
  });

  it("echoes the normalised email back so the user does not retype it", async () => {
    const { client } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() =>
      attemptLogin(client, { ...VALID, email: "  Ada@180DC.org ", password: "" }),
    );

    assert.equal(rejected(result).email, "ada@180dc.org");
  });
});

describe("attemptLogin — CAPTCHA", () => {
  it("refuses to submit credentials when the CAPTCHA has not been solved", async () => {
    const { client, calls } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() =>
      attemptLogin(client, { ...VALID, captchaToken: "" }),
    );

    assert.match(rejected(result).message ?? "", /CAPTCHA/);
    assert.deepEqual(calls.signIn, [], "the password must not leave the server unverified");
  });

  it("forwards the token to Supabase when it is present", async () => {
    const { client, calls } = fakeClient({ user: makeUser() });
    await silencingLogs(() => attemptLogin(client, VALID));

    assert.equal(calls.signIn[0]?.captchaToken, "turnstile-token");
  });

  it("does not blame the password when Supabase rejects the CAPTCHA", async () => {
    const { client } = fakeClient({ error: "captcha protection: request disallowed" });
    const { result } = await silencingLogs(() => attemptLogin(client, VALID));

    const state = rejected(result);
    assert.match(state.message ?? "", /CAPTCHA/);
    assert.doesNotMatch(state.message ?? "", /password/i);
  });
});

describe("attemptLogin — credentials", () => {
  it("gives one generic message for a wrong password", async () => {
    const { client } = fakeClient({ error: "Invalid login credentials" });
    const { result } = await silencingLogs(() => attemptLogin(client, VALID));

    assert.equal(rejected(result).message, "Invalid email or password.");
  });

  it("gives the identical message for an unknown email (AC3)", async () => {
    const wrongPassword = await silencingLogs(() =>
      attemptLogin(fakeClient({ error: "Invalid login credentials" }).client, VALID),
    );
    const unknownEmail = await silencingLogs(() =>
      attemptLogin(fakeClient({ error: "User not found" }).client, {
        ...VALID,
        email: "nobody@180dc.org",
      }),
    );

    assert.equal(
      rejected(wrongPassword.result).message,
      rejected(unknownEmail.result).message,
      "the message must not reveal whether the account exists",
    );
  });

  it("never leaks the Supabase error text to the user", async () => {
    const { client } = fakeClient({ error: "User not found in auth.users" });
    const { result } = await silencingLogs(() => attemptLogin(client, VALID));

    assert.doesNotMatch(rejected(result).message ?? "", /auth\.users|not found/i);
  });

  it("treats a missing user with no error as a failed login", async () => {
    const { client } = fakeClient({ user: null as unknown as User });
    const { result } = await silencingLogs(() => attemptLogin(client, VALID));

    assert.equal(rejected(result).message, "Invalid email or password.");
  });
});

describe("attemptLogin — account status", () => {
  it("signs an unapproved user straight back out and reports pending activation (AC4)", async () => {
    const { client, calls } = fakeClient({ user: makeUser("pending") });
    const { result } = await silencingLogs(() => attemptLogin(client, VALID));

    const state = rejected(result);
    assert.equal(state.status, "pending");
    assert.match(state.message ?? "", /pending activation/i);
    assert.equal(calls.signOut, 1, "the session must not survive the check");
  });

  it("blocks a user who just accepted an invite but was never approved (F009 AC3)", async () => {
    // Accepting an invite (setting a first password) never touches
    // app_metadata.account_status — Supabase leaves it unset, not "pending" or
    // any other placeholder string, which is what makeUser(undefined) models.
    // This is what makes F009's "created inactive until an admin grants
    // access" true without any code of its own: the gate already refuses
    // anyone without an explicit "approved" status, invite or not.
    const { client, calls } = fakeClient({ user: makeUser(undefined) });
    const { result } = await silencingLogs(() => attemptLogin(client, VALID));

    const state = rejected(result);
    assert.equal(state.status, "pending");
    assert.match(state.message ?? "", /pending activation/i);
    assert.equal(calls.signOut, 1, "the session must not survive the check");
  });

  it("turns a suspended user away and closes the session it just opened (F013 AC2)", async () => {
    const { client, calls } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() =>
      attemptLogin(client, VALID, undefined, undefined, async () => false),
    );

    const state = rejected(result);
    assert.equal(state.status, "pending");
    assert.equal(state.message, SUSPENDED_MESSAGE);
    assert.equal(
      calls.signOut,
      1,
      "signInWithPassword already opened a session; it must not survive",
    );
  });

  it("admits an active user (F013 — the check only bites when is_active is false)", async () => {
    const { client } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() =>
      attemptLogin(client, VALID, undefined, undefined, async () => true),
    );

    assert.equal(result.ok, true);
  });

  it("admits the user when the status cannot be read, leaving the dashboard gate to decide", async () => {
    // A missing service-role key must not lock the whole team out of logging in.
    // getCurrentActor still refuses a suspended account on the very next request.
    const { client } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() =>
      attemptLogin(client, VALID, undefined, undefined, async () => null),
    );

    assert.equal(result.ok, true);
  });

  it("does not consult the suspension reader before credentials pass", async () => {
    const { client } = fakeClient({ error: "Invalid login credentials" });
    let consulted = false;
    await silencingLogs(() =>
      attemptLogin(client, VALID, undefined, undefined, async () => {
        consulted = true;
        return false;
      }),
    );

    assert.equal(
      consulted,
      false,
      "reading account state for a failed sign-in would leak whether the account exists",
    );
  });

  it("admits the user on valid credentials with no suspension reader configured (AC2)", async () => {
    const { client, calls } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() => attemptLogin(client, VALID));

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.signOut, 0);
  });
});

describe("attemptLogin — service failure", () => {
  it("returns a try-again message instead of throwing", async () => {
    const { client } = fakeClient({ throws: new Error("fetch failed: ECONNREFUSED") });
    const { result } = await silencingLogs(() => attemptLogin(client, VALID));

    assert.equal(rejected(result).message, SERVICE_UNAVAILABLE_MESSAGE);
  });

  it("keeps the underlying cause out of the browser but in the logs", async () => {
    const { client } = fakeClient({ throws: new Error("ECONNREFUSED 10.0.0.1:5432") });
    const { result, logs } = await silencingLogs(() => attemptLogin(client, VALID));

    assert.doesNotMatch(rejected(result).message ?? "", /ECONNREFUSED/);
    assert.match(logs.join(" "), /ECONNREFUSED/);
  });
});

describe("attemptLogin — secrets", () => {
  it("never puts the password in the returned state or the logs (AC5)", async () => {
    const password = "s3cret-never-log-me";
    const cases: Parameters<typeof fakeClient>[0][] = [
      { error: "Invalid login credentials" },
      { user: makeUser() },
      { throws: new Error("boom") },
    ];

    for (const behaviour of cases) {
      const { client } = fakeClient(behaviour);
      const { result, logs } = await silencingLogs(() =>
        attemptLogin(client, { ...VALID, password }),
      );

      assert.doesNotMatch(JSON.stringify(result), new RegExp(password));
      assert.doesNotMatch(logs.join(" "), new RegExp(password));
    }
  });

  it("does not echo the password back on a validation failure", async () => {
    const { client } = fakeClient({ user: makeUser() });
    const { result } = await silencingLogs(() =>
      attemptLogin(client, { email: "ada@gmail.com", password: "s3cret", captchaToken: "t" }),
    );

    assert.doesNotMatch(JSON.stringify(result), /s3cret/);
  });
});

describe("attemptLogin — throttle (F227)", () => {
  /** A throttle whose answers the test dictates, recording what it was asked. */
  function fakeThrottle(blockedUntil: Date | null, earns: Date | null = null) {
    const calls: { checked: string[]; recorded: string[]; cleared: string[] } = {
      checked: [],
      recorded: [],
      cleared: [],
    };
    const throttle: LoginThrottle = {
      blockedUntil: async (email) => {
        calls.checked.push(email);
        return blockedUntil;
      },
      recordFailure: async (email) => {
        calls.recorded.push(email);
        return earns;
      },
      clear: async (email) => {
        calls.cleared.push(email);
      },
    };
    return { throttle, calls };
  }

  it("refuses a throttled address before the password reaches Supabase", async () => {
    const { client, calls } = fakeClient({ user: makeUser() });
    const { throttle } = fakeThrottle(new Date(Date.now() + 120_000));

    const { result } = await silencingLogs(() =>
      attemptLogin(client, VALID, undefined, throttle),
    );

    assert.match(rejected(result).message ?? "", /Too many failed login attempts/);
    assert.deepEqual(calls.signIn, [], "a throttled attempt must not be sent to Supabase");
  });

  it("checks the throttle with the normalised address", async () => {
    const { client } = fakeClient({ user: makeUser() });
    const { throttle, calls } = fakeThrottle(null);

    await silencingLogs(() =>
      attemptLogin(client, { ...VALID, email: "  Ada@180DC.org " }, undefined, throttle),
    );

    assert.deepEqual(calls.checked, ["ada@180dc.org"]);
  });

  it("does not check the throttle until the CAPTCHA token is present", async () => {
    const { client } = fakeClient({ user: makeUser() });
    const { throttle, calls } = fakeThrottle(null);

    await silencingLogs(() =>
      attemptLogin(client, { ...VALID, captchaToken: "" }, undefined, throttle),
    );

    assert.deepEqual(calls.checked, [], "throttle state must not be probeable for free");
  });

  it("records a rejected credential", async () => {
    const { client } = fakeClient({ error: "Invalid login credentials" });
    const { throttle, calls } = fakeThrottle(null);

    await silencingLogs(() => attemptLogin(client, VALID, undefined, throttle));

    assert.deepEqual(calls.recorded, ["ada@180dc.org"]);
  });

  it("does not count a CAPTCHA rejection as a wrong password", async () => {
    const { client } = fakeClient({ error: "captcha verification process failed" });
    const { throttle, calls } = fakeThrottle(null);

    await silencingLogs(() => attemptLogin(client, VALID, undefined, throttle));

    assert.deepEqual(calls.recorded, []);
  });

  it("reports the block as soon as the failure earns one", async () => {
    const { client } = fakeClient({ error: "Invalid login credentials" });
    const { throttle } = fakeThrottle(null, new Date(Date.now() + 30_000));

    const { result } = await silencingLogs(() =>
      attemptLogin(client, VALID, undefined, throttle),
    );

    assert.match(rejected(result).message ?? "", /Try again in 30 seconds/);
  });

  it("still says only \"Invalid email or password\" while inside the free allowance", async () => {
    const { client } = fakeClient({ error: "Invalid login credentials" });
    const { throttle } = fakeThrottle(null, null);

    const { result } = await silencingLogs(() =>
      attemptLogin(client, VALID, undefined, throttle),
    );

    assert.equal(rejected(result).message, "Invalid email or password.");
  });

  it("clears the count on a correct password", async () => {
    const { client } = fakeClient({ user: makeUser() });
    const { throttle, calls } = fakeThrottle(null);

    const { result } = await silencingLogs(() =>
      attemptLogin(client, VALID, undefined, throttle),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(calls.cleared, ["ada@180dc.org"]);
  });

  it("never logs the throttled address", async () => {
    const { client } = fakeClient({ user: makeUser() });
    const { throttle } = fakeThrottle(new Date(Date.now() + 120_000));

    const { logs } = await silencingLogs(() =>
      attemptLogin(client, VALID, undefined, throttle),
    );

    assert.doesNotMatch(logs.join(" "), /ada@180dc\.org/);
  });
});
