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
