/**
 * Translating `suspend_user` and `delete_user` refusals into something an admin can act on.
 *
 * Both RPCs attach a stable HINT to every exception they raise, and this module is the
 * only place those hints are interpreted. Kept out of the route handler so it can be
 * tested directly: the mapping is a lookup table, and the failure mode is silent. A
 * hint that drifts out of step with the migration does not crash — it falls through to
 * the generic message, and the admin who hit the reassignment gate is told to "refresh
 * and try again" instead of being asked where the clients should go. The test suite
 * reads the migration and asserts every hint it raises is answered here.
 */

export type AccountChange = "suspend" | "delete";

/** Every hint `delete_user` can raise, directly or through the helpers it calls. */
export const DELETE_USER_HINTS = [
  "not_admin",
  "self_access_change",
  "reason_required",
  "owns_active_clients",
  "ambiguous_destination",
  "reassign_to_self",
  "destination_not_found",
  "destination_not_eligible",
  // Raised by app.guard_last_admin on delete_user's behalf (F012, matrix §6 gap 7).
  "last_admin",
] as const;

/** Every hint `suspend_user` can raise, directly or through the helpers it calls. */
export const SUSPEND_USER_HINTS = [
  "not_admin",
  "self_access_change",
  "user_deleted",
  "reason_required",
  "ambiguous_destination",
  "reassign_to_self",
  "destination_not_found",
  "destination_not_eligible",
  "last_admin",
] as const;

type Hint =
  | (typeof DELETE_USER_HINTS)[number]
  | (typeof SUSPEND_USER_HINTS)[number];

const SHARED: Partial<Record<Hint, string>> = {
  reason_required: "Give a reason, so the handover can be understood later.",
  // Not a mistake — this is the reassignment gate asking the question it exists to
  // ask, so the sentence says what to do next rather than what went wrong.
  owns_active_clients:
    "This member still owns clients. Choose who takes them on, or release them to the unowned pool.",
  ambiguous_destination: "Choose either a new owner or the unowned pool, not both.",
  reassign_to_self: "Clients cannot be handed back to the member they are being taken from.",
  destination_not_found:
    "The team member you chose to take on the clients no longer exists. Refresh and try again.",
  destination_not_eligible: "Clients can only be handed to an active CAM or admin.",
  user_deleted: "This account has already been deleted.",
};

const PER_ACTION: Record<AccountChange, Partial<Record<Hint, string>>> = {
  suspend: {
    not_admin: "Only an admin can suspend a team member.",
    self_access_change: "You cannot suspend your own account.",
    last_admin:
      "You cannot suspend the platform's last active admin. Promote another admin first.",
  },
  delete: {
    not_admin: "Only an admin can delete a team member.",
    self_access_change: "You cannot delete your own account.",
    last_admin:
      "You cannot delete the platform's last active admin. Promote another admin first.",
  },
};

const FALLBACK: Record<AccountChange, string> = {
  suspend: "The suspension was blocked. Refresh and try again.",
  delete: "The deletion was blocked. Refresh and try again.",
};

/**
 * Reactivation's refusals. `set_user_active` attaches a HINT; switching on it rather
 * than the message means rewording an exception cannot change what the admin reads.
 */
export function reactivateFailureMessage(hint: string | null | undefined): string {
  switch (hint) {
    case "not_admin":
      return "Only an admin can change a team member's access.";
    case "user_deleted":
      return "A deleted account cannot be reactivated.";
    default:
      return "The access change was blocked. Refresh and try again.";
  }
}

export function accountChangeFailureMessage(
  change: AccountChange,
  hint: string | null | undefined,
): string {
  if (!hint) return FALLBACK[change];
  const key = hint as Hint;
  return PER_ACTION[change][key] ?? SHARED[key] ?? FALLBACK[change];
}

/**
 * `owns_active_clients` is 409, not 400: the request was well formed and the admin is
 * permitted; the server state is what makes it impossible right now, and the client is
 * expected to choose a destination and retry.
 */
export function accountChangeFailureStatus(
  code: string | null | undefined,
  hint: string | null | undefined,
): number {
  if (hint === "owns_active_clients") return 409;
  if (code === "42501") return 403;
  if (code === "22023" || code === "P0002") return 400;
  return 500;
}
