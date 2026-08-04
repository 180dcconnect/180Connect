import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  logRoleChangeDenial,
  roleFailureMessage,
  type AuditLogWriter,
} from "./permission-denial.ts";

describe("roleFailureMessage", () => {
  it("names the last-admin rail rather than echoing the RPC's raw wording", () => {
    assert.equal(
      roleFailureMessage({
        code: "42501",
        hint: "last_admin",
        message: "this would leave the platform with no active admin",
      }),
      "You cannot remove the platform's last active admin. Promote another admin first.",
    );
  });

  it("explains a self-role-change refusal", () => {
    assert.equal(
      roleFailureMessage({ code: "42501", hint: "self_role_change" }),
      "You cannot change your own administrator role.",
    );
  });

  it("explains a non-admin refusal", () => {
    assert.equal(
      roleFailureMessage({ code: "42501", hint: "not_admin" }),
      "Only an admin can change a team member's role.",
    );
  });

  it("falls back to a generic sentence for a 42501 carrying no hint", () => {
    assert.equal(
      roleFailureMessage({ code: "42501", message: "permission denied for table users" }),
      "The role change was blocked. Refresh and try again.",
    );
  });

  it("never puts a raw Postgres message in front of a user", () => {
    const raw = "permission denied for table users";
    assert.notEqual(roleFailureMessage({ code: "42501", message: raw }), raw);
  });

  it("gives a generic retry message for any other error code", () => {
    assert.equal(
      roleFailureMessage({ code: "23505", message: "duplicate key" }),
      "The role change could not be saved. Please try again.",
    );
  });
});

describe("logRoleChangeDenial", () => {
  it("inserts an audit_log row describing the blocked attempt", async () => {
    const inserted: Record<string, unknown>[] = [];
    const tablesQueried: string[] = [];
    const admin: AuditLogWriter = {
      from: (table) => {
        tablesQueried.push(table);
        return {
          insert: async (row) => {
            inserted.push(row);
            return { error: null };
          },
        };
      },
    };

    const result = await logRoleChangeDenial(admin, {
      actorId: "admin-1",
      targetUserId: "cam-1",
      attemptedRole: "admin",
      reason: "Only an admin can change roles.",
    });

    assert.deepEqual(result, { error: null });
    assert.deepEqual(tablesQueried, ["audit_log"]);
    assert.deepEqual(inserted, [
      {
        actor_user_id: "admin-1",
        action: "role_change_denied",
        target_table: "users",
        target_id: "cam-1",
        detail: { attempted_role: "admin", reason: "Only an admin can change roles." },
      },
    ]);
  });

  it("surfaces the writer's own error without throwing", async () => {
    const admin: AuditLogWriter = {
      from: () => ({
        insert: async () => ({ error: { message: "insert failed" } }),
      }),
    };

    const result = await logRoleChangeDenial(admin, {
      actorId: "admin-1",
      targetUserId: "cam-1",
      attemptedRole: "admin",
      reason: "blocked",
    });

    assert.deepEqual(result, { error: { message: "insert failed" } });
  });

  it("fails without touching the client when no service-role client is available", async () => {
    const result = await logRoleChangeDenial(null, {
      actorId: "admin-1",
      targetUserId: "cam-1",
      attemptedRole: "admin",
      reason: "blocked",
    });

    assert.equal(result.error instanceof Error, true);
    assert.match((result.error as Error).message, /service-role key unavailable/);
  });
});
