export const ROLES = ["cam", "admin", "viewer"] as const;

export type AppRole = (typeof ROLES)[number];

export const PERMISSIONS = [
  "client:view",
  "client:edit",
  "client:contact",
  "user:manage",
  "ownership:reassign",
  "approval:manage",
  "platform-settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PermissionFailureReason =
  | "unauthenticated"
  | "not_approved"
  | "inactive"
  | "profile_missing"
  | "forbidden";

export type AuthorizableUser = {
  id: string;
  email?: string;
  app_metadata: unknown;
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
  cam: new Set(["client:view", "client:edit", "client:contact"]),
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

export function authorizeUserProfile(
  user: AuthorizableUser | null,
  profile: UserProfile | null,
  permission?: Permission,
): AuthorizedProfileResult {
  if (!user) return { ok: false, reason: "unauthenticated" };
  const appMetadata =
    user.app_metadata && typeof user.app_metadata === "object"
      ? user.app_metadata as Record<string, unknown>
      : {};
  if (appMetadata.account_status !== "approved") {
    return { ok: false, reason: "not_approved" };
  }
  if (!profile) return { ok: false, reason: "profile_missing" };
  if (!profile.is_active) return { ok: false, reason: "inactive" };
  if (!isAppRole(profile.role)) return { ok: false, reason: "forbidden" };
  if (permission && !hasPermission(profile.role, permission)) {
    return { ok: false, reason: "forbidden" };
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
