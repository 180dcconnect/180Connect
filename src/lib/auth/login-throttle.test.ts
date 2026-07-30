import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createLoginThrottle,
  describeWait,
  NO_THROTTLE,
  throttleMessage,
  type ThrottleRpcClient,
} from "./login-throttle.ts";

/** Swallows the console.error that `logSecurityEvent` writes on a failure path. */
async function silencingLogs<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeRpc(
  behaviour: { data?: unknown; error?: string; throws?: boolean } = {},
): { client: ThrottleRpcClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  return {
    calls,
    client: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (behaviour.throws) throw new Error("socket hang up");
        return {
          data: behaviour.data ?? null,
          error: behaviour.error ? { message: behaviour.error } : null,
        };
      },
    },
  };
}

describe("describeWait", () => {
  it("reports whole seconds under a minute", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    assert.equal(describeWait(new Date("2026-07-30T12:00:30Z"), now), "30 seconds");
  });

  it("uses the singular for one unit", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    assert.equal(describeWait(new Date("2026-07-30T12:00:01Z"), now), "1 second");
    assert.equal(describeWait(new Date("2026-07-30T12:01:00Z"), now), "1 minute");
  });

  it("rounds up, so the message never invites a retry that is still too early", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    // 61s is more than a minute away: "1 minute" would be a lie the user acts on.
    assert.equal(describeWait(new Date("2026-07-30T12:01:01Z"), now), "2 minutes");
    assert.equal(describeWait(new Date("2026-07-30T12:00:00.400Z"), now), "1 second");
  });

  it("never reports a wait in the past as negative", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    assert.equal(describeWait(new Date("2026-07-30T11:59:00Z"), now), "1 second");
  });
});

describe("throttleMessage", () => {
  it("says nothing about whether the account exists", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const message = throttleMessage(new Date("2026-07-30T12:05:00Z"), now);
    assert.equal(message, "Too many failed login attempts. Try again in 5 minutes.");
    // The guard that matters: an enumeration oracle would need a word like
    // "account", "email", "registered" or "exists" to differ between the two cases.
    for (const leak of ["account", "email", "registered", "exists", "unknown"]) {
      assert.ok(!message.toLowerCase().includes(leak), `message mentions "${leak}"`);
    }
  });
});

describe("createLoginThrottle", () => {
  it("passes the email to the state RPC and parses the timestamp", async () => {
    const { client, calls } = fakeRpc({ data: "2026-07-30T12:05:00Z" });
    const blockedUntil = await createLoginThrottle(client).blockedUntil("ada@180dc.org");

    assert.deepEqual(calls, [
      { name: "login_throttle_state", args: { p_email: "ada@180dc.org" } },
    ]);
    assert.equal(blockedUntil?.toISOString(), "2026-07-30T12:05:00.000Z");
  });

  it("reads a null block as not throttled", async () => {
    const { client } = fakeRpc({ data: null });
    assert.equal(await createLoginThrottle(client).blockedUntil("ada@180dc.org"), null);
  });

  it("returns the block that a recorded failure earned", async () => {
    const { client, calls } = fakeRpc({ data: "2026-07-30T12:00:30Z" });
    const earned = await createLoginThrottle(client).recordFailure("ada@180dc.org");

    assert.equal(calls[0]?.name, "record_login_failure");
    assert.equal(earned?.toISOString(), "2026-07-30T12:00:30.000Z");
  });

  it("clears through the clear RPC", async () => {
    const { client, calls } = fakeRpc();
    await createLoginThrottle(client).clear("ada@180dc.org");
    assert.deepEqual(calls, [
      { name: "clear_login_failures", args: { p_email: "ada@180dc.org" } },
    ]);
  });

  // The fail-open contract. A throttle that denies logins when its own storage is
  // unreachable turns a database blip into a total sign-in outage.
  it("fails open when the RPC returns an error", async () => {
    const { client } = fakeRpc({ error: "permission denied for function" });
    const throttle = createLoginThrottle(client);
    assert.equal(await silencingLogs(() => throttle.blockedUntil("ada@180dc.org")), null);
  });

  it("fails open when the RPC throws", async () => {
    const { client } = fakeRpc({ throws: true });
    const throttle = createLoginThrottle(client);
    assert.equal(await silencingLogs(() => throttle.blockedUntil("ada@180dc.org")), null);
  });

  it("logs the reason when it fails open, so an outage is not silent", async () => {
    const { client } = fakeRpc({ error: "permission denied for function" });
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logs.push(args);
    try {
      await createLoginThrottle(client).blockedUntil("ada@180dc.org");
    } finally {
      console.error = original;
    }

    assert.equal(logs.length, 1);
    assert.match(String(logs[0]?.[0]), /login_throttle_unavailable/);
  });

  it("ignores a non-string payload rather than producing an Invalid Date", async () => {
    const { client } = fakeRpc({ data: 1738238400 });
    assert.equal(await createLoginThrottle(client).blockedUntil("ada@180dc.org"), null);
  });
});

describe("NO_THROTTLE", () => {
  it("never blocks, so a missing service-role key cannot lock anyone out", async () => {
    assert.equal(await NO_THROTTLE.blockedUntil("ada@180dc.org"), null);
    assert.equal(await NO_THROTTLE.recordFailure("ada@180dc.org"), null);
    assert.equal(await NO_THROTTLE.clear("ada@180dc.org"), undefined);
  });
});
