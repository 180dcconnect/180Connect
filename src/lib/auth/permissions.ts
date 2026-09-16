export const ROLES = ["cam", "admin", "viewer"] as const;

export type AppRole = (typeof ROLES)[number];

export const PERMISSIONS = [
  "client:view",
  "client:edit",
  "client:contact",
  "tags:manage",
  "user:manage",
  "ownership:reassign",
  "approval:manage",
  "platform-settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PermissionFailureReason =
  | "unauthenticated"
  | "inactive"
  | "profile_missing"
  | "forbidden"
  // A viewer reached for something that changes data. Distinct from `forbidden`
  // so the refusal can say "your access is view-only" rather than "you lack
  // permission", and so the browser can be told to show the view-only notice.
  | "view_only";

export type AuthorizableUser = {
  id: string;
  email?: string;
};

export type UserProfile = {
  id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
};

export type AuthorizedProfileResult =
  | { ok: true; role: AppRole }
  | { ok: false; reason: PermissionFailureReason };

const ROLE_PERMISSIONS: Record<AppRole, ReadonlySet<Permission>> = {
  cam: new Set(["client:view", "client:edit", "client:contact", "tags:manage"]),
  admin: new Set(PERMISSIONS),
  viewer: new Set(["client:view"]),
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && ROLES.includes(value as AppRole);
}

export function hasPermission(
  role: AppRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * A viewer is 180DC leadership — the branch president and vice president, and
 * the Global Leadership Team. They see everything an admin sees and change
 * nothing (decision of the Project Leader, 15 Sep 2026; docs/open-questions.md
 * Q-06).
 */
export function isViewOnly(role: AppRole): boolean {
  return role === "viewer";
}

/**
 * Whether a role may *see* what a permission guards: the page, the list, the
 * button. Every role that holds the permission may, and so may a viewer, who
 * sees the whole app but is refused when they press a control that changes
 * something.
 *
 * Use this for what renders. Never use it to decide whether a write may happen
 * — that is `hasPermission`, which a viewer never passes for a write.
 */
export function canView(role: AppRole, permission: Permission): boolean {
  return hasPermission(role, permission) || isViewOnly(role);
}

/**
 * Whether a role is shown what an admin is shown — admin panels, admin copy,
 * the admin version of a control. True for admins and for viewers.
 *
 * Display only, like `canView`. What an admin may *do* is still decided by
 * `hasPermission` on the server, which a viewer never passes.
 */
export function seesAdminView(role: AppRole): boolean {
  return role === "admin" || isViewOnly(role);
}

/**
 * `access` says what the caller is about to do with the permission:
 * - `"use"` (default) — perform the action it guards. Server actions and
 *   mutating API routes. A viewer is always refused, with reason `view_only`.
 * - `"view"` — render the screen it guards. Pages and read-only endpoints.
 *   A viewer passes (see `canView`).
 */
export function authorizeUserProfile(
  user: AuthorizableUser | null,
  profile: UserProfile | null,
  permission?: Permission,
  access: "use" | "view" = "use",
): AuthorizedProfileResult {
  if (!user) return { ok: false, reason: "unauthenticated" };
  if (!profile) return { ok: false, reason: "profile_missing" };
  if (!profile.is_active) return { ok: false, reason: "inactive" };
  if (!isAppRole(profile.role)) return { ok: false, reason: "forbidden" };
  if (permission) {
    const allowed =
      access === "view"
        ? canView(profile.role, permission)
        : hasPermission(profile.role, permission);
    if (!allowed) {
      return { ok: false, reason: isViewOnly(profile.role) ? "view_only" : "forbidden" };
    }
  }
  return { ok: true, role: profile.role };
}

export function canChangeRole(
  actorId: string,
  targetUserId: string,
): { ok: true } | { ok: false; message: string } {
  if (actorId === targetUserId) {
    return {
      ok: false,
      message: "You cannot change your own administrator role.",
    };
  }
  return { ok: true };
}

/**
 * The self-suspension rail (F013), checked here so the admin gets a sentence they
 * can act on rather than a 403 from the database.
 *
 * `set_user_active` refuses the same thing inside its SECURITY DEFINER body — that
 * is the check that actually holds, since anyone can call the RPC directly through
 * PostgREST. This one exists for the message, not for the security.
 */
export function canChangeAccess(
  actorId: string,
  targetUserId: string,
): { ok: true } | { ok: false; message: string } {
  if (actorId === targetUserId) {
    return {
      ok: false,
      message: "You cannot suspend your own account.",
    };
  }
  return { ok: true };
}
