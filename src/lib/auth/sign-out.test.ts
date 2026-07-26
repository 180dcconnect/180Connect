import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { signOutAndReport, type SignOutClient } from "./sign-out.ts";

function clientReturning(error: { message: string } | null): SignOutClient {
  return { auth: { signOut: async () => ({ error }) } };
}

/** Runs `fn` with console.error captured, and returns what it was called with. */
async function captureConsoleError(fn: () => Promise<void>): Promise<string[]> {
  const errorMock = mock.method(console, "error", () => {});
  try {
    await fn();
    return errorMock.mock.calls.map((call) => call.arguments.join(" "));
  } finally {
    errorMock.mock.restore();
  }
}

describe("signOutAndReport", () => {
  it("reports success and logs nothing when Supabase signs the user out", async () => {
    let result = false;
    const logs = await captureConsoleError(async () => {
      result = await signOutAndReport(clientReturning(null));
    });

    assert.equal(result, true);
    assert.deepEqual(logs, []);
  });

  it("logs the failure when signOut returns an error", async () => {
    let result = true;
    const logs = await captureConsoleError(async () => {
      result = await signOutAndReport(clientReturning({ message: "session missing" }));
    });

    assert.equal(result, false);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /\[error-logging\]/);
    assert.match(logs[0], /logout_failed/);
    assert.match(logs[0], /session missing/);
  });

  it("logs the failure and does not throw when signOut itself rejects", async () => {
    const rejecting: SignOutClient = {
      auth: {
        signOut: async () => {
          throw new Error("network down");
        },
      },
    };

    let result = true;
    const logs = await captureConsoleError(async () => {
      result = await signOutAndReport(rejecting);
    });

    assert.equal(result, false);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /network down/);
  });
});
