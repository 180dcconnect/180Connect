import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DEACTIVATION_HINTS,
  deactivationFailureMessage,
  deactivationFailureStatus,
} from "./deactivation.ts";

// The *effective* definition, not the original: 20260804153000 `create or replace`s
// deactivate_user to add the last-admin guard, so that is the body actually running.
const MIGRATION = "supabase/migrations/20260804153000_last_admin_guard.sql";

/** The text of one `create or replace function <name>(` … `$$;` block. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.notEqual(start, -1, `${name} is not defined in ${MIGRATION}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name}'s body is not terminated in ${MIGRATION}`);
  return sql.slice(start, end);
}

describe("deactivation failure messages", () => {
  it("answers every hint the migration can raise", () => {
    // The point of this test. The RPC and this module are two files that have to agree
    // on a set of string literals, with nothing between them to enforce it — no shared
    // type, no generated client. Adding a refusal to the migration and forgetting the
    // message here does not fail a build or throw at runtime; it silently degrades to
    // "refresh and try again", which for owns_active_clients means the reassignment
    // gate stops explaining itself. So the test reads the SQL and checks.
    //
    // Scoped to deactivate_user's own body plus the helper it delegates a refusal to,
    // rather than the whole file: the same migration also defines set_user_role and
    // set_user_active, whose hints are answered elsewhere and are none of this
    // module's business.
    const sql = readFileSync(MIGRATION, "utf8");
    let scanned = functionBody(sql, "public.deactivate_user");
    if (scanned.includes("app.guard_last_admin")) {
      scanned += functionBody(sql, "app.guard_last_admin");
    }
    const raised = new Set(
      [...scanned.matchAll(/hint\s*=\s*'([a-z_]+)'/g)].map((match) => match[1]),
    );

    assert.ok(raised.size > 0, "no hints found in the migration — check the regex");

    for (const hint of raised) {
      assert.ok(
        (DEACTIVATION_HINTS as readonly string[]).includes(hint),
        `the migration raises hint '${hint}' but nothing maps it to a message`,
      );
    }

    for (const hint of DEACTIVATION_HINTS) {
      assert.ok(
        raised.has(hint),
        `'${hint}' is mapped here but no longer raised by the migration`,
      );
    }
  });

  it("gives every known hint its own sentence", () => {
    const seen = new Set<string>();
    for (const hint of DEACTIVATION_HINTS) {
      const message = deactivationFailureMessage(hint);
      assert.ok(message.length > 0);
      assert.ok(
        !seen.has(message),
        `'${hint}' reuses another hint's message, so the admin cannot tell them apart`,
      );
      seen.add(message);
    }
  });

  it("tells the admin what to do when the reassignment gate refuses", () => {
    const message = deactivationFailureMessage("owns_active_clients");
    assert.match(message, /owns clients/);
    assert.match(message, /unowned pool/);
  });

  it("falls back to a generic sentence for an unrecognised hint", () => {
    for (const hint of [null, undefined, "", "something_new"]) {
      assert.equal(
        deactivationFailureMessage(hint),
        "The deactivation was blocked. Refresh and try again.",
      );
    }
  });
});

describe("deactivation failure status", () => {
  it("maps the reassignment gate to 409, not 400", () => {
    // 409 is what the UI branches on to open the destination picker. A well-formed,
    // permitted request that the current server state makes impossible is a conflict,
    // not malformed input — and the hint wins over the SQLSTATE, which is 22023 here
    // and would otherwise read as a validation failure.
    assert.equal(deactivationFailureStatus("22023", "owns_active_clients"), 409);
  });

  it("maps permission refusals to 403", () => {
    assert.equal(deactivationFailureStatus("42501", "not_admin"), 403);
    assert.equal(deactivationFailureStatus("42501", "self_access_change"), 403);
  });

  it("maps bad input and a missing user to 400", () => {
    assert.equal(deactivationFailureStatus("22023", "reason_required"), 400);
    assert.equal(deactivationFailureStatus("22023", "reassign_to_self"), 400);
    assert.equal(deactivationFailureStatus("P0002", "destination_not_found"), 400);
  });

  it("treats anything unrecognised as a server fault", () => {
    // Deliberately 500 rather than 400: an unmapped SQLSTATE means the database failed
    // in a way this route does not understand, and calling that the client's fault
    // would hide it from the error log's severity filter.
    assert.equal(deactivationFailureStatus("XX000", null), 500);
    assert.equal(deactivationFailureStatus(null, null), 500);
  });
});
