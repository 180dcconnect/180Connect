import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REDACTED,
  buildReport,
  buildSentryEnvelope,
  parseDsn,
  reportError,
  resolveConfig,
  scrub,
  type LoggingConfig,
} from "./error-logging.ts";

const config: LoggingConfig = {
  environment: "test",
  platform: "node",
};

describe("scrub", () => {
  it("redacts values under sensitive keys", () => {
    const out = scrub({
      password: "hunter2",
      apiKey: "sk_live_abc123",
      authorization: "Bearer xyz",
      cookie: "session=abc",
      email_body: "safe",
    }) as Record<string, unknown>;

    assert.equal(out.password, REDACTED);
    assert.equal(out.apiKey, REDACTED);
    assert.equal(out.authorization, REDACTED);
    assert.equal(out.cookie, REDACTED);
    assert.equal(out.email_body, "safe");
  });

  it("redacts nested and array-held secrets", () => {
    const out = scrub({
      user: { name: "Ada", accessToken: "t0ken" },
      headers: [{ authorization: "Bearer abc" }],
    }) as { user: Record<string, unknown>; headers: Array<Record<string, unknown>> };

    assert.equal(out.user.name, "Ada");
    assert.equal(out.user.accessToken, REDACTED);
    assert.equal(out.headers[0].authorization, REDACTED);
  });

  it("masks email addresses so full PII is not logged", () => {
    const out = scrub({ note: "contact jane.doe@180dc.org please" }) as {
      note: string;
    };
    assert.doesNotMatch(out.note, /jane\.doe/);
    assert.match(out.note, /@180dc\.org/);
  });

  it("redacts secret-looking substrings in free text", () => {
    const jwt = "eyJhbGciOi.JzdWIiOiIx.SflKxwRJSM";
    const out = scrub(`token was ${jwt} oops`) as string;
    assert.doesNotMatch(out, /eyJhbGci/);
    assert.match(out, new RegExp(REDACTED.replace(/[[\]]/g, "\\$&")));
  });

  it("does not mutate the input", () => {
    const input = { password: "hunter2" };
    scrub(input);
    assert.equal(input.password, "hunter2");
  });

  it("breaks circular references instead of overflowing", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const out = scrub(a) as Record<string, unknown>;
    assert.equal(out.self, "[circular]");
  });

  it("caps deeply nested structures", () => {
    let deep: Record<string, unknown> = { value: "bottom" };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    // Should return without throwing and terminate with a truncation marker.
    const serialised = JSON.stringify(scrub(deep));
    assert.match(serialised, /\[truncated\]/);
  });
});

describe("buildReport", () => {
  it("captures message, stack, and an ISO timestamp", () => {
    const report = buildReport(new Error("boom"), {}, config);
    assert.equal(report.name, "Error");
    assert.equal(report.message, "boom");
    assert.match(report.stack ?? "", /boom/);
    assert.match(report.timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.equal(report.environment, "test");
    assert.match(report.eventId, /^[0-9a-f]{32}$/);
  });

  it("handles a thrown non-Error value", () => {
    const report = buildReport("just a string", {}, config);
    assert.equal(report.message, "just a string");
    assert.equal(report.stack, undefined);
  });

  it("reads a Supabase PostgrestError instead of rendering [object Object]", () => {
    // The real shape supabase-js returns: a plain object, not an Error. This
    // exact case logged "[object Object]" and hid a missing-function error.
    const report = buildReport(
      {
        message: "Could not find the function public.set_user_active",
        code: "PGRST202",
        hint: "Perhaps you meant set_user_role",
        details: null,
      },
      { operation: "admin.users.set_active" },
      config,
    );

    assert.equal(report.message, "Could not find the function public.set_user_active");
    assert.equal(report.context.errorCode, "PGRST202");
    assert.equal(report.context.errorHint, "Perhaps you meant set_user_role");
    // details was null, so it is left out rather than logged as an empty field.
    assert.equal("errorDetails" in report.context, false);
    assert.equal(report.context.operation, "admin.users.set_active");
  });

  it("falls back to JSON for an object carrying no message", () => {
    const report = buildReport({ weird: true }, {}, config);
    assert.equal(report.message, '{"weird":true}');
  });

  it("does not let an error field overwrite the caller's context", () => {
    const report = buildReport(
      { message: "boom", code: "FROM_ERROR" },
      { errorCode: "FROM_CALLER" },
      config,
    );
    assert.equal(report.context.errorCode, "FROM_CALLER");
  });

  it("scrubs sensitive data out of request headers and context", () => {
    const report = buildReport(
      new Error("nope"),
      {
        request: {
          path: "/login",
          method: "POST",
          headers: { cookie: "sb-session=secret", "user-agent": "test" },
        },
        password: "hunter2",
        userEmail: "jane.doe@180dc.org",
      },
      config,
    );

    const serialised = JSON.stringify(report);
    assert.doesNotMatch(serialised, /hunter2/);
    assert.doesNotMatch(serialised, /sb-session=secret/);
    assert.doesNotMatch(serialised, /jane\.doe/);
    // Non-sensitive context survives.
    assert.match(serialised, /user-agent/);
    assert.equal(report.request?.method, "POST");
  });
});

describe("parseDsn", () => {
  it("parses a well-formed DSN into an envelope URL", () => {
    const parsed = parseDsn("https://abc123@o42.ingest.sentry.io/1337");
    assert.ok(parsed);
    assert.equal(parsed.publicKey, "abc123");
    assert.equal(parsed.projectId, "1337");
    assert.match(parsed.envelopeUrl, /o42\.ingest\.sentry\.io\/api\/1337\/envelope\//);
    assert.match(parsed.envelopeUrl, /sentry_key=abc123/);
  });

  it("rejects malformed DSNs", () => {
    assert.equal(parseDsn("not-a-dsn"), null);
    assert.equal(parseDsn("https://o42.ingest.sentry.io/1337"), null); // no key
    assert.equal(parseDsn("https://abc123@o42.ingest.sentry.io/"), null); // no project
  });
});

describe("buildSentryEnvelope", () => {
  it("produces three newline-delimited JSON lines", () => {
    const report = buildReport(new Error("boom"), {}, config);
    const envelope = buildSentryEnvelope(report, "https://k@h/1");
    const lines = envelope.trim().split("\n");
    assert.equal(lines.length, 3);
    const header = JSON.parse(lines[0]);
    const item = JSON.parse(lines[1]);
    const payload = JSON.parse(lines[2]);
    assert.equal(header.event_id, report.eventId);
    assert.equal(item.type, "event");
    assert.equal(payload.exception.values[0].value, "boom");
    assert.equal(payload.level, "error");
  });
});

describe("resolveConfig", () => {
  it("defaults to development with no Sentry configured", () => {
    const previous = { ...process.env };
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.SENTRY_ENVIRONMENT;
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    try {
      const resolved = resolveConfig();
      assert.equal(resolved.dsn, undefined);
      assert.equal(resolved.environment, "development");
    } finally {
      Object.assign(process.env, previous);
    }
  });
});

describe("reportError", () => {
  it("never throws, even on a broken value, and logs without a DSN", async () => {
    const previous = { ...process.env };
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const originalError = console.error;
    let logged = "";
    console.error = (...args: unknown[]) => {
      logged += args.join(" ");
    };
    try {
      await assert.doesNotReject(() =>
        reportError(new Error("kaboom"), { password: "hunter2" }),
      );
      assert.match(logged, /kaboom/);
      assert.doesNotMatch(logged, /hunter2/);
    } finally {
      console.error = originalError;
      Object.assign(process.env, previous);
    }
  });
});
