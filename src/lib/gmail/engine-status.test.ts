import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getGmailEngineHealth, getOutreachEngineHealth } from "./engine-status.ts";

const COMPLETE_SOURCE = {
  GMAIL_CLIENT_ID: "client",
  GMAIL_CLIENT_SECRET: "secret",
  GMAIL_REFRESH_TOKEN: "refresh",
  GMAIL_SENDER_EMAIL: "Clients.Sheffield@180dc.org",
};

/** reportError degrades to console.error and logApiHealth to console.info when
    observability is unconfigured; keep test output clean. */
async function quiet<T>(run: () => Promise<T>): Promise<T> {
  const originalError = console.error;
  const originalInfo = console.info;
  console.error = () => undefined;
  console.info = () => undefined;
  try {
    return await run();
  } finally {
    console.error = originalError;
    console.info = originalInfo;
  }
}

function tokenOk() {
  return Response.json({ access_token: "test-access-token" });
}

function profileOk(emailAddress = "clients.sheffield@180dc.org") {
  return Response.json({ emailAddress });
}

/** Routes the OAuth exchange and the Gmail profile lookup to separate stubs. */
function stubFetch(options: {
  token: () => Response | Promise<Response>;
  profile?: (auth: string | null) => Response | Promise<Response>;
}): typeof fetch {
  return (async (input: unknown, init?: { headers?: unknown }) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) return options.token();
    if (url.includes("gmail.googleapis.com")) {
      const auth = new Headers(init?.headers as HeadersInit).get("Authorization");
      assert.equal(auth, "Bearer test-access-token");
      return options.profile?.(auth) ?? profileOk();
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

describe("getGmailEngineHealth", () => {
  it("is unconfigured when credentials are absent", async () => {
    const health = await getGmailEngineHealth({});
    assert.equal(health.status, "unconfigured");
    assert.equal(health.sender, null);
  });

  it("is unconfigured when the sender mailbox is missing but OAuth is present", async () => {
    const health = await getGmailEngineHealth({
      GMAIL_CLIENT_ID: "client",
      GMAIL_CLIENT_SECRET: "secret",
      GMAIL_REFRESH_TOKEN: "refresh",
    });
    assert.equal(health.status, "unconfigured");
  });

  it("is active when the token refreshes and the profile matches the sender", async () => {
    const health = await quiet(() =>
      getGmailEngineHealth(
        COMPLETE_SOURCE,
        stubFetch({ token: tokenOk, profile: () => profileOk() }),
      ),
    );
    assert.equal(health.status, "active");
    assert.equal(health.sender, "clients.sheffield@180dc.org");
  });

  it("needs re-authorisation when the refresh token is rejected", async () => {
    const health = await quiet(() =>
      getGmailEngineHealth(
        COMPLETE_SOURCE,
        stubFetch({
          token: () => new Response("{}", { status: 401 }),
        }),
      ),
    );
    assert.equal(health.status, "reauth-required");
  });

  it("needs re-authorisation when the profile call is forbidden", async () => {
    const health = await quiet(() =>
      getGmailEngineHealth(
        COMPLETE_SOURCE,
        stubFetch({
          token: tokenOk,
          profile: () => new Response("{}", { status: 403 }),
        }),
      ),
    );
    assert.equal(health.status, "reauth-required");
  });

  it("is degraded when Gmail answers with a transient failure", async () => {
    const health = await quiet(() =>
      getGmailEngineHealth(
        COMPLETE_SOURCE,
        stubFetch({
          token: tokenOk,
          profile: () => new Response("{}", { status: 500 }),
        }),
      ),
    );
    assert.equal(health.status, "degraded");
  });

  it("is degraded when the network fails outright", async () => {
    const failing: typeof fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const health = await quiet(() => getGmailEngineHealth(COMPLETE_SOURCE, failing));
    assert.equal(health.status, "degraded");
  });

  it("is degraded when the token belongs to a different mailbox", async () => {
    const health = await quiet(() =>
      getGmailEngineHealth(
        COMPLETE_SOURCE,
        stubFetch({
          token: tokenOk,
          profile: () => profileOk("someone-else@example.org"),
        }),
      ),
    );
    assert.equal(health.status, "degraded");
  });
});

/** Stubs the one RPC call `getOutreachEngineHealth` makes for the cron jobs. */
function stubSupabase(
  rpcImpl: (
    name: string,
    args: unknown,
  ) => Promise<{ data: unknown; error: unknown }>,
) {
  return { rpc: rpcImpl } as unknown as Parameters<typeof getOutreachEngineHealth>[0];
}

describe("getOutreachEngineHealth", () => {
  it("marks both cron jobs unconfigured when no job row is returned", async () => {
    const health = await quiet(() =>
      getOutreachEngineHealth(
        stubSupabase(async () => ({ data: [], error: null })),
        {},
      ),
    );
    assert.equal(health.replySync.status, "unconfigured");
    assert.equal(health.scheduledSend.status, "unconfigured");
  });

  it("marks both cron jobs degraded when the RPC errors", async () => {
    const health = await quiet(() =>
      getOutreachEngineHealth(
        stubSupabase(async () => ({ data: null, error: new Error("boom") })),
        {},
      ),
    );
    assert.equal(health.replySync.status, "degraded");
    assert.equal(health.scheduledSend.status, "degraded");
  });

  it("marks a cron job active when its last run just succeeded", async () => {
    const health = await quiet(() =>
      getOutreachEngineHealth(
        stubSupabase(async () => ({
          data: [
            {
              job_name: "gmail_reply_sync",
              last_run_at: new Date().toISOString(),
              last_run_succeeded: true,
            },
          ],
          error: null,
        })),
        {},
      ),
    );
    assert.equal(health.replySync.status, "active");
    assert.equal(health.scheduledSend.status, "unconfigured");
  });

  it("marks a cron job degraded when its last run failed", async () => {
    const health = await quiet(() =>
      getOutreachEngineHealth(
        stubSupabase(async () => ({
          data: [
            {
              job_name: "scheduled_outreach_delivery",
              last_run_at: new Date().toISOString(),
              last_run_succeeded: false,
            },
          ],
          error: null,
        })),
        {},
      ),
    );
    assert.equal(health.scheduledSend.status, "degraded");
  });

  it("marks a cron job degraded when its last successful run is stale", async () => {
    const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const health = await quiet(() =>
      getOutreachEngineHealth(
        stubSupabase(async () => ({
          data: [
            {
              job_name: "gmail_reply_sync",
              last_run_at: staleTimestamp,
              last_run_succeeded: true,
            },
          ],
          error: null,
        })),
        {},
      ),
    );
    assert.equal(health.replySync.status, "degraded");
  });

  it("describes what a healthy job does instead of only when it last ran", async () => {
    const lastRun = new Date();
    const health = await quiet(() =>
      getOutreachEngineHealth(
        stubSupabase(async () => ({
          data: [
            {
              job_name: "gmail_reply_sync",
              last_run_at: lastRun.toISOString(),
              last_run_succeeded: true,
            },
          ],
          error: null,
        })),
        {},
      ),
    );
    assert.equal(health.replySync.status, "active");
    // The tooltip is the only place the row can explain itself, so the
    // sentence leads with what the job does for the CAM ...
    assert.match(health.replySync.detail, /^Reply sync checks the branch mailbox/);
    // ... and closes with when it last proved itself, as a formatted time
    // rather than the raw ISO instant Postgres handed back.
    assert.match(health.replySync.detail, /Last run completed at /);
    assert.ok(!health.replySync.detail.includes(lastRun.toISOString()));
  });

  it("still names the job when a run failed or has never happened", async () => {
    const health = await quiet(() =>
      getOutreachEngineHealth(
        stubSupabase(async () => ({
          data: [
            {
              job_name: "scheduled_outreach_delivery",
              last_run_at: new Date().toISOString(),
              last_run_succeeded: false,
            },
          ],
          error: null,
        })),
        {},
      ),
    );
    assert.equal(health.scheduledSend.status, "degraded");
    assert.match(
      health.scheduledSend.detail,
      /^Scheduled send sends queued outreach/,
    );
    assert.match(health.scheduledSend.detail, /last run failed at /);
    // The job with no rows at all is described too, so its X is explicable.
    assert.match(health.replySync.detail, /^Reply sync checks the branch mailbox/);
  });
});
