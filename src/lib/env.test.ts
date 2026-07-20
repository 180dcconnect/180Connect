import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SCHEMA,
  assertEnv,
  collectEnvProblems,
  formatEnvProblems,
} from "./env.ts";

/** A minimal environment in which every required variable is set and valid. */
function validEnv(): Record<string, string | undefined> {
  const source: Record<string, string | undefined> = {};
  for (const spec of SCHEMA) {
    if (spec.required) {
      source[spec.name] = "http://localhost:3000";
    }
  }
  return source;
}

describe("collectEnvProblems", () => {
  it("reports nothing when every required variable is set", () => {
    assert.deepEqual(collectEnvProblems(validEnv()), []);
  });

  it("ignores unset optional variables", () => {
    const optional = SCHEMA.filter((spec) => !spec.required);
    assert.ok(optional.length > 0, "expected the schema to have optional vars");

    const problems = collectEnvProblems(validEnv());
    assert.deepEqual(problems, []);
  });

  it("reports a required variable that is missing", () => {
    const source = validEnv();
    delete source.NEXT_PUBLIC_APP_URL;

    assert.deepEqual(collectEnvProblems(source), [
      { name: "NEXT_PUBLIC_APP_URL", problem: "is required but not set" },
    ]);
  });

  it("treats a whitespace-only value as unset", () => {
    const problems = collectEnvProblems({
      ...validEnv(),
      NEXT_PUBLIC_APP_URL: "   ",
    });

    assert.deepEqual(problems, [
      { name: "NEXT_PUBLIC_APP_URL", problem: "is required but not set" },
    ]);
  });

  it("reports a set variable that fails its own validation", () => {
    const problems = collectEnvProblems({
      ...validEnv(),
      NEXT_PUBLIC_APP_URL: "localhost:3000",
    });

    assert.equal(problems.length, 1);
    assert.equal(problems[0].name, "NEXT_PUBLIC_APP_URL");
    assert.match(problems[0].problem, /absolute http/);
  });

  it("rejects a non-http protocol", () => {
    const problems = collectEnvProblems({
      ...validEnv(),
      NEXT_PUBLIC_APP_URL: "ftp://example.com",
    });

    assert.equal(problems.length, 1);
    assert.match(problems[0].problem, /absolute http/);
  });

  it("validates an optional variable that is set", () => {
    const problems = collectEnvProblems({
      ...validEnv(),
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
    });

    assert.equal(problems.length, 1);
    assert.equal(problems[0].name, "NEXT_PUBLIC_SUPABASE_URL");
  });

  it("reports every problem at once rather than stopping at the first", () => {
    const problems = collectEnvProblems({
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
    });

    assert.equal(problems.length, 2);
    assert.deepEqual(
      problems.map((problem) => problem.name).sort(),
      ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL"],
    );
  });
});

describe("formatEnvProblems", () => {
  it("names the variable and points at the documentation", () => {
    const message = formatEnvProblems([
      { name: "NEXT_PUBLIC_APP_URL", problem: "is required but not set" },
    ]);

    assert.match(message, /NEXT_PUBLIC_APP_URL/);
    assert.match(message, /\.env\.example/);
    assert.match(message, /docs\/environment-variables\.md/);
    assert.match(message, /1 problem\b/);
  });

  it("does not leak the value of a secret", () => {
    const secret = "super-secret-service-role-key";
    const message = formatEnvProblems(
      collectEnvProblems({
        ...validEnv(),
        SUPABASE_SERVICE_ROLE_KEY: secret,
        NEXT_PUBLIC_SUPABASE_URL: secret,
      }),
    );

    assert.doesNotMatch(message, new RegExp(secret));
  });
});

describe("assertEnv", () => {
  it("returns quietly when the environment is valid", () => {
    assert.doesNotThrow(() => assertEnv(validEnv()));
  });

  it("throws with the formatted message when it is not", () => {
    assert.throws(
      () => assertEnv({}),
      /NEXT_PUBLIC_APP_URL is required but not set/,
    );
  });
});
