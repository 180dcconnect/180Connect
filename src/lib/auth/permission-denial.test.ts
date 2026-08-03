import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  logRoleChangeDenial,
  roleFailureMessage,
  type AuditLogWriter,
} from "./permission-denial.ts";

describe("roleFailureMessage", () => {
  it("shows the RPC's own message for an insufficient_privilege error", () => {
    assert.equal(
      roleFailureMessage({ code: "42501", message: "Only an admin can change roles." }),
      "Only an admin can change roles.",
    );
  });

  it("falls back to a generic sentence if 42501 has no message", () => {
    assert.equal(roleFailureMessage({ code: "42501" }), "The role change was blocked.");
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
