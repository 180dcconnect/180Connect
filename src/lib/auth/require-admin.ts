/**
 * Admin-only permission check (F221).
 *
 * Layered on top of requireApprovedUser: an admin must also be an approved,
 * active user. Role lives in public.users, not the JWT, so this needs a
 * Supabase query and is async, unlike requireApprovedUser.
 *
 * This is a UX check only — the real security boundary is the audit_log
 * table's own RLS policy (admin-only SELECT), so a bug here cannot leak rows,
 * it can only mis-render a redirect.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  requireApprovedUser,
  permissionFailureMessage,
  type PermissionFailureReason,
} from "./require-approved-user.ts";

export type AdminPermissionFailureReason = PermissionFailureReason | "not_admin";

export type AdminPermissionResult =
  | { ok: true }
  | { ok: false; reason: AdminPermissionFailureReason };

export async function requireAdmin(
  supabase: SupabaseClient,
  user: User | null,
): Promise<AdminPermissionResult> {
  const approved = requireApprovedUser(user);
  if (!approved.ok || !user) {
    // The `!user` arm is unreachable in practice — requireApprovedUser already
    // rejects a null user — but TypeScript can't narrow across the function
    // call, so this satisfies the compiler without a non-null assertion.
    return approved.ok ? { ok: false, reason: "unauthenticated" } : approved;
  }

  const { data } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (data?.role !== "admin") {
    return { ok: false, reason: "not_admin" };
  }

  return { ok: true };
}

export function adminPermissionFailureMessage(reason: AdminPermissionFailureReason): string {
  if (reason === "not_admin") {
    return "This page is only available to administrators.";
  }
  return permissionFailureMessage(reason);
}
