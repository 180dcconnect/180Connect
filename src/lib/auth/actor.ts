import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import {
  authorizeUserProfile,
  type AppRole,
  type Permission,
  type PermissionFailureReason,
  type UserProfile,
} from "./permissions";

export type Actor = {
  id: string;
  email: string | null;
  fullName: string | null;
  role: AppRole;
};

export type ActorFailureReason = PermissionFailureReason;

export type ActorResult =
  | { ok: true; actor: Actor }
  | { ok: false; reason: ActorFailureReason };

/**
 * Extra detail attached to the `permission.denied` log line. `route` is worth
 * passing from any page gate: without it a denial says which permission was
 * missing but not which screen was being reached for, which is the difference
 * between a log you can act on and one you can only count.
 */
export type ActorContext = { route?: string };

export async function getCurrentActor(
  permission?: Permission,
  context: ActorContext = {},
): Promise<ActorResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, reason: "unauthenticated" };

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle<UserProfile>();

  if (error) {
    logSecurityEvent("permission.denied", {
      ...context,
      reason: "profile_lookup_failed",
      permission,
    });
    return { ok: false, reason: "profile_missing" };
  }

  const authorization = authorizeUserProfile(user, data, permission);
  if (!authorization.ok) {
    logSecurityEvent("permission.denied", {
      ...context,
      userId: user.id,
      reason: authorization.reason,
      permission,
    });
    return authorization;
  }
  return {
    ok: true,
    actor: {
      id: data!.id,
      email: user.email ?? null,
      fullName: data!.full_name,
      role: authorization.role,
    },
  };
}

export function actorFailureMessage(reason: ActorFailureReason): string {
  switch (reason) {
    case "unauthenticated":
      return "You must be logged in to do that.";
    case "inactive":
      return "Your account is inactive. Contact an administrator.";
    case "profile_missing":
      return "Your access profile is not available. Contact an administrator.";
    case "forbidden":
      return "You do not have permission to perform this action.";
  }
}
