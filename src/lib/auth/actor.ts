import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
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

/**
 * How stale `last_seen_at` must be before this call bothers writing it. getCurrentActor
 * runs on every signed-in page (AppShell) and every admin API route, so touching it
 * unconditionally would be a write per request; this caps it at one every 5 minutes per
 * user, which is plenty fresh for a "last active" label.
 */
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

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
    .select("id, full_name, role, is_active, last_seen_at")
    .eq("id", user.id)
    .maybeSingle<UserProfile & { last_seen_at: string | null }>();

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

  // Not last login — last time this user was seen on any signed-in page or admin API
  // call. Fire-and-await (not fire-and-forget: a serverless invocation can be frozen
  // the moment the response is sent, which would drop an un-awaited write) but only
  // when stale, so this is a rare write, not one per request. A failure here must never
  // block the request it's riding along with.
  const lastSeenAt = data!.last_seen_at ? new Date(data!.last_seen_at).getTime() : 0;
  if (Date.now() - lastSeenAt > LAST_SEEN_THROTTLE_MS) {
    const { error: touchError } = await supabase.rpc("touch_last_seen");
    if (touchError) {
      await reportError(touchError, {
        operation: "auth.touch_last_seen",
        userId: user.id,
      });
    }
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
