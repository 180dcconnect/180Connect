/**
 * Role checks for the app layer (F258).
 *
 * The database is the enforcement boundary, not this file. Every rule here has a
 * matching RLS policy, and the policy is what actually stops a write — see
 * `docs/rls-permission-matrix.md`. What this adds is the *other* half of F016 AC2 /
 * F017 AC2 / F258 AC4: a UI that does not offer an action the database is going to
 * refuse, and a clear reason when one is refused anyway.
 *
 * So: never treat a check here as sufficient. A Server Action calls
 * `requireWriteAccess` to fail early and explain itself; it still runs the write
 * through the user's own Supabase client so RLS gets the final say.
 *
 * `requireApprovedUser` (F222) answers "may this account act at all?" from the JWT.
 * This answers "what may it do?", which needs `public.users.role` — a table read,
 * because the role deliberately lives outside the token. F016 AC4 requires a role
 * change to take effect on the user's next request without a logout, and a claim
 * baked into a JWT cannot do that: the old token stays valid until it expires.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PermissionResult } from "./require-approved-user";

/** Mirrors the `public.user_role` enum (Data Model tab 04, USERS.role). */
export const USER_ROLES = ["admin", "cam", "viewer"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function isAdmin(role: UserRole | null): boolean {
  return role === "admin";
}

export function isCam(role: UserRole | null): boolean {
  return role === "cam";
}

export function isViewer(role: UserRole | null): boolean {
  return role === "viewer";
}

/**
 * Admin or CAM. The app-layer twin of `app.can_write()`, and deliberately written
 * as an allow-list rather than `role !== "viewer"`: a role added to the enum later
 * is read-only here until someone decides otherwise, which is the safe direction to
 * be wrong in.
 */
export function canWrite(role: UserRole | null): boolean {
  return role === "admin" || role === "cam";
}

/**
 * Gate a write. `null` means the role could not be established — an unmirrored
 * account, or a failed lookup — and is treated as unauthenticated rather than
 * read-only, because we do not know that the user is a viewer.
 */
export function requireWriteAccess(role: UserRole | null): PermissionResult {
  if (role === null) {
    return { ok: false, reason: "unauthenticated" };
  }

  if (!canWrite(role)) {
    return { ok: false, reason: "read_only" };
  }

  return { ok: true };
}

/**
 * Reads the caller's role from `public.users`.
 *
 * Runs through the caller's own client, so the row comes back under the
 * `users_select_active` policy: a deactivated user reads nothing and gets `null`,
 * which `requireWriteAccess` then refuses. Any other failure also returns `null` —
 * this must never fail open, and a lookup error is not evidence of permission.
 */
export async function fetchUserRole(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserRole | null> {
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return isUserRole(data.role) ? data.role : null;
}
