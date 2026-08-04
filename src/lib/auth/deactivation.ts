/**
 * Translating `deactivate_user`'s refusals into something an admin can act on — F014.
 *
 * The RPC attaches a stable HINT to every exception it raises, and this module is the
 * only place those hints are interpreted. Kept out of the route handler so it can be
 * tested directly: the mapping is a lookup table, and the failure mode is silent. A
 * hint that drifts out of step with the migration does not crash — it falls through to
 * the generic message, and the admin who hit the reassignment gate is told to "refresh
 * and try again" instead of being asked where the clients should go. The test suite
 * reads the migration and asserts every hint it raises is answered here.
 */

/** Every hint `deactivate_user` can raise. Keep in step with the migration. */
export const DEACTIVATION_HINTS = [
  "owns_active_clients",
  "self_access_change",
  "not_admin",
  "reason_required",
  "destination_not_found",
  "destination_not_eligible",
  "reassign_to_self",
  "ambiguous_destination",
  // Raised indirectly: deactivate_user calls app.guard_last_admin, which raises this
  // one on its behalf (F012, matrix §6 gap 7).
  "last_admin",
] as const;

export type DeactivationHint = (typeof DEACTIVATION_HINTS)[number];

const MESSAGES: Record<DeactivationHint, string> = {
  // Not a mistake — this is the reassignment gate (AC2) asking the question it exists
  // to ask, so the sentence says what to do next rather than what went wrong.
  owns_active_clients:
    "This member still owns clients. Choose who takes them on, or release them to the unowned pool, then try again.",
  self_access_change: "You cannot deactivate your own account.",
  not_admin: "Only an admin can deactivate a team member.",
  reason_required: "Give a reason for the deactivation.",
  destination_not_found:
    "The team member you chose to take on the clients no longer exists. Refresh and try again.",
  destination_not_eligible:
    "Clients can only be reassigned to an active CAM or admin.",
  reassign_to_self:
    "Clients cannot be reassigned to the member being deactivated.",
  ambiguous_destination:
    "Choose either a new owner or the unowned pool, not both.",
  last_admin:
    "You cannot deactivate the platform's last active admin. Promote another admin first.",
};

function isKnownHint(hint: unknown): hint is DeactivationHint {
  return (
    typeof hint === "string" &&
    (DEACTIVATION_HINTS as readonly string[]).includes(hint)
  );
}

export function deactivationFailureMessage(
  hint: string | null | undefined,
): string {
  return isKnownHint(hint)
    ? MESSAGES[hint]
    : "The deactivation was blocked. Refresh and try again.";
}

/**
 * `owns_active_clients` is 409, not 400: the request was well formed and the admin is
 * permitted: the server state is what makes it impossible right now, and the client is
 * expected to resolve it and retry. The UI branches on this to open the destination
 * picker, so it must not be lumped in with malformed input.
 */
export function deactivationFailureStatus(
  code: string | null | undefined,
  hint: string | null | undefined,
): number {
  if (hint === "owns_active_clients") return 409;
  if (code === "42501") return 403;
  if (code === "22023" || code === "P0002") return 400;
  return 500;
}
