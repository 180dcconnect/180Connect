import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DELETE_USER_HINTS,
  SUSPEND_USER_HINTS,
  accountChangeFailureMessage,
  accountChangeFailureStatus,
} from "./account-changes.ts";

const MIGRATION = "supabase/migrations/20260930090000_replace_deactivation_with_delete.sql";
const GUARD_MIGRATION = "supabase/migrations/20260804153000_last_admin_guard.sql";

/** The text of one `create or replace function <name>(` … `$$;` block. */
function functionBody(sql: string, name: string, file: string): string {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.notEqual(start, -1, `${name} is not defined in ${file}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name}'s body is not terminated in ${file}`);
  return sql.slice(start, end);
}

function hintsRaisedBy(body: string): Set<string> {
  return new Set([...body.matchAll(/hint\s*=\s*'([a-z_]+)'/g)].map((match) => match[1]));
}

/**
 * The RPC and this module are two files that have to agree on a set of string
 * literals, with nothing between them to enforce it. Forgetting a message does not fail
 * a build; it silently degrades to "refresh and try again". So the test reads the SQL.
 *
 * Scoped to the RPC's own body plus the helpers it delegates refusals to — not the
 * whole file, whose other functions answer to other modules.
 */
function assertHintsMatch(rpc: string, helpers: string[], mapped: readonly string[]) {
  const sql = readFileSync(MIGRATION, "utf8");
  let scanned = functionBody(sql, rpc, MIGRATION);
  for (const helper of helpers) scanned += functionBody(sql, helper, MIGRATION);
  if (scanned.includes("app.guard_last_admin")) {
    scanned += functionBody(readFileSync(GUARD_MIGRATION, "utf8"), "app.guard_last_admin", GUARD_MIGRATION);
  }
  const raised = hintsRaisedBy(scanned);

  assert.ok(raised.size > 0, "no hints found in the migration — check the regex");
  for (const hint of raised) {
    assert.ok(mapped.includes(hint), `${rpc} raises hint '${hint}' but nothing maps it to a message`);
  }
  for (const hint of mapped) {
    assert.ok(raised.has(hint), `'${hint}' is mapped for ${rpc} but no longer raised`);
  }
}

describe("account change failure messages", () => {
  it("answers every hint delete_user can raise", () => {
    assertHintsMatch("public.delete_user", ["app.transfer_user_work"], DELETE_USER_HINTS);
  });

  it("answers every hint suspend_user can raise", () => {
    // suspend_user ends in set_user_active, which raises last_admin through the guard.
    assertHintsMatch(
      "public.suspend_user",
      ["app.transfer_user_work", "public.set_user_active"],
      SUSPEND_USER_HINTS,
    );
  });

  it("gives every known hint its own sentence within an action", () => {
    for (const [change, hints] of [
      ["delete", DELETE_USER_HINTS],
      ["suspend", SUSPEND_USER_HINTS],
    ] as const) {
      const seen = new Set<string>();
      for (const hint of hints) {
        const message = accountChangeFailureMessage(change, hint);
        assert.ok(!message.includes("Refresh and try again") || hint === "destination_not_found",
          `'${hint}' fell through to the generic ${change} message`);
        assert.ok(!seen.has(message), `'${hint}' reuses another hint's message for ${change}`);
        seen.add(message);
      }
    }
  });

  it("names the action the admin actually took", () => {
    assert.match(accountChangeFailureMessage("delete", "last_admin"), /delete/);
    assert.match(accountChangeFailureMessage("suspend", "last_admin"), /suspend/);
  });

  it("tells the admin what to do when the reassignment gate refuses", () => {
    const message = accountChangeFailureMessage("delete", "owns_active_clients");
    assert.match(message, /owns clients/);
    assert.match(message, /unowned pool/);
  });

  it("falls back to a generic sentence for an unrecognised hint", () => {
    for (const hint of [null, undefined, "", "something_new"]) {
      assert.equal(
        accountChangeFailureMessage("delete", hint),
        "The deletion was blocked. Refresh and try again.",
      );
    }
  });
});

describe("account change failure status", () => {
  it("maps the reassignment gate to 409, not 400", () => {
    assert.equal(accountChangeFailureStatus("22023", "owns_active_clients"), 409);
  });

  it("maps permission refusals to 403", () => {
    assert.equal(accountChangeFailureStatus("42501", "not_admin"), 403);
    assert.equal(accountChangeFailureStatus("42501", "self_access_change"), 403);
  });

  it("maps bad input and a missing user to 400", () => {
    assert.equal(accountChangeFailureStatus("22023", "reason_required"), 400);
    assert.equal(accountChangeFailureStatus("P0002", "destination_not_found"), 400);
  });

  it("treats anything unrecognised as a server fault", () => {
    assert.equal(accountChangeFailureStatus("XX000", null), 500);
    assert.equal(accountChangeFailureStatus(null, null), 500);
  });
});
