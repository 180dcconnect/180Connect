/**
 * F012: turns a blocked role change into the sentence an admin should read.
 *
 * `42501` (insufficient_privilege) is the one Postgres code that always means "the
 * rules refused this" (docs/rls-permission-matrix.md §4), and `set_user_role`
 * attaches a HINT to say which rule. Switching on the hint rather than on the
 * message is the same convention `accessFailureMessage` follows, and for the same
 * reason: rewording an exception in a migration must not silently change what an
 * admin reads, and a raw Postgres message is not a sentence written for a user
 * ("this would leave the platform with no active admin").
 */
export function roleFailureMessage(error: {
  code?: string;
  hint?: string | null;
  message?: string;
}): string {
  if (error.code !== "42501") {
    return "The role change could not be saved. Please try again.";
  }
  switch (error.hint) {
    case "self_role_change":
      return "You cannot change your own administrator role.";
    case "not_admin":
      return "Only an admin can change a team member's role.";
    case "last_admin":
      return "You cannot remove the platform's last active admin. Promote another admin first.";
    default:
      return "The role change was blocked. Refresh and try again.";
  }
}

/** The one call `logRoleChangeDenial` makes, kept minimal so tests can fake it. */
export type AuditLogWriter = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
};

/**
 * Records a blocked role-change attempt (matrix §4's "observable" denial case).
 * `set_user_role` only writes `audit_log` on success, and `authenticated` has no
 * INSERT grant on that table by design — so a denial is logged here, through the
 * service-role client, rather than left with no trace at all.
 *
 * Takes the admin client as a parameter (rather than building one itself) so this
 * can be unit-tested without a real service-role key, the same way `attemptLogin`
 * takes its Supabase client as a parameter.
 *
 * WHY NOT INSIDE THE RPC. `set_user_role` writes its success row itself, so a
 * denial row belongs there too — except a denial is a `raise exception`, and the
 * exception rolls back the very insert that would record it. Logging it there needs
 * an autonomous transaction (dblink or pg_background), neither of which is installed.
 * Hence here, at the one caller that survives the refusal. The cost is that a denial
 * raised against a direct PostgREST call, which never touches this route, still
 * leaves no audit row — tracked as a known limit, not an oversight.
 */
export async function logRoleChangeDenial(
  admin: AuditLogWriter | null,
  params: {
    actorId: string;
    targetUserId: string;
    attemptedRole: string;
    reason: string | undefined;
  },
): Promise<{ error: unknown }> {
  if (!admin) {
    return { error: new Error("service-role key unavailable") };
  }
  return admin.from("audit_log").insert({
    actor_user_id: params.actorId,
    action: "role_change_denied",
    target_table: "users",
    target_id: params.targetUserId,
    detail: { attempted_role: params.attemptedRole, reason: params.reason },
  });
}
