/**
 * F012: turns a blocked RLS/RPC write into the message a CAM or admin should
 * see. `42501` (insufficient_privilege) is the one Postgres code that always
 * means "the rules refused this" — its accompanying message is written by
 * the RPC itself to be human-readable (docs/rls-permission-matrix.md §4), so
 * it's shown as-is rather than replaced with something generic.
 */
export function roleFailureMessage(error: { code?: string; message?: string }): string {
  if (error.code === "42501") {
    return error.message || "The role change was blocked.";
  }
  return "The role change could not be saved. Please try again.";
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
 * can be unit-tested without a real service-role key, the same way `requireAdmin`
 * and `attemptLogin` take their Supabase client as a parameter.
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
