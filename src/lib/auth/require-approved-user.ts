/**
 * Central permission check (F222).
 *
 * Every Server Action/route handler that does anything sensitive should call
 * this instead of checking `account_status` inline — it was previously
 * duplicated in the login action and `src/app/dashboard/page.tsx`.
 * Full RBAC/RLS is out of scope here and lands with F224.
 */

import type { User } from "@supabase/supabase-js";

export type PermissionFailureReason = "unauthenticated" | "not_approved";

export type PermissionResult =
  | { ok: true }
  | { ok: false; reason: PermissionFailureReason };

export function requireApprovedUser(user: User | null): PermissionResult {
  if (!user) {
    return { ok: false, reason: "unauthenticated" };
  }

  if (user.app_metadata.account_status !== "approved") {
    return { ok: false, reason: "not_approved" };
  }

  return { ok: true };
}

/**
 * User-facing message for a permission failure. Deliberately does not reveal
 * whether the thing being accessed exists — only that the user can't have it.
 */
export function permissionFailureMessage(reason: PermissionFailureReason): string {
  switch (reason) {
    case "unauthenticated":
      return "You must be logged in to do that.";
    case "not_approved":
      return "Your account is pending activation by an administrator.";
  }
}
