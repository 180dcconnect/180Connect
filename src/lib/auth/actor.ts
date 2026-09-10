import { cache } from "react";

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

type LoadedProfile =
  | { ok: true; userId: string; profile: ProfileRow | null }
  | { ok: false; reason: "unauthenticated" | "profile_lookup_failed" };

type ProfileRow = UserProfile & { email: string; last_seen_at: string | null };

/**
 * The signed-in user's id and profile row, resolved once per request.
 *
 * ── Why this is a separate, argument-less function ──
 *
 * `cache()` keys on argument identity, and `getCurrentActor` is called as
 * `getCurrentActor("client:view", { route: "/clients" })` — a fresh object
 * literal every time. Memoising `getCurrentActor` itself would therefore
 * produce one cache entry per call site and deduplicate nothing. Only the part
 * that takes no arguments can be shared, so that is the part that is cached;
 * the permission check and its denial logging stay per-call, which is what
 * keeps each call site's own gate and its own `permission.denied` line.
 *
 * This matters because `getCurrentActor` runs two to three times per page:
 * `AppShell` calls it, `SettingsShell` calls it, and the page calls it again
 * with the permission it actually needs. Each of those used to be a round trip
 * to the Auth server plus a `users` select.
 *
 * ── Why getClaims and not getUser ──
 *
 * `getUser()` is a network call to the Supabase Auth server on every
 * invocation. `getClaims()` verifies the access token locally against the
 * project's asymmetric signing key (both staging and production publish ES256
 * keys at `/auth/v1/.well-known/jwks.json`, and the key set is cached), so the
 * usual path costs no network at all. It still refreshes a session that is
 * about to expire, so the behaviour the proxy depends on is unchanged.
 *
 * The email comes from `public.users.email` (`not null`) rather than from the
 * token, so it is read from the row this function already fetches — no second
 * source to disagree with, and one fewer reason to call the Auth server.
 */
const loadAuthenticatedProfile = cache(async (): Promise<LoadedProfile> => {
  const supabase = await createClient();

  let userId: string | null = null;

  const { data: claimed, error: claimsError } = await supabase.auth.getClaims();
  if (claimed?.claims?.sub) {
    userId = claimed.claims.sub;
  } else if (claimsError) {
    // Falling back to the pre-existing path rather than treating a verification
    // failure as "signed out": a JWKS fetch that fails transiently, or a token
    // still signed with the legacy symmetric secret, would otherwise sign
    // everybody out at once. `getUser` asks the Auth server directly, which is
    // exactly what this function did before.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  if (!userId) return { ok: false, reason: "unauthenticated" };

  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active, last_seen_at")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  if (error) return { ok: false, reason: "profile_lookup_failed" };

  return { ok: true, userId, profile: data };
});

/**
 * Not last login — last time this user was seen on any signed-in page or admin
 * API call. Cached so that a page calling `getCurrentActor` three times records
 * one visit, not three.
 *
 * Fire-and-await (not fire-and-forget: a serverless invocation can be frozen the
 * moment the response is sent, which would drop an un-awaited write) but only
 * when stale, so this is a rare write, not one per request. A failure here must
 * never block the request it's riding along with.
 */
const touchLastSeen = cache(async (userId: string, lastSeenAt: string | null) => {
  const seenAtMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  if (Date.now() - seenAtMs <= LAST_SEEN_THROTTLE_MS) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("touch_last_seen");
  if (error) {
    await reportError(error, { operation: "auth.touch_last_seen", userId });
  }
});

export async function getCurrentActor(
  permission?: Permission,
  context: ActorContext = {},
): Promise<ActorResult> {
  const loaded = await loadAuthenticatedProfile();

  if (!loaded.ok) {
    if (loaded.reason === "unauthenticated") {
      return { ok: false, reason: "unauthenticated" };
    }
    logSecurityEvent("permission.denied", {
      ...context,
      reason: "profile_lookup_failed",
      permission,
    });
    return { ok: false, reason: "profile_missing" };
  }

  const { userId, profile } = loaded;

  const authorization = authorizeUserProfile({ id: userId }, profile, permission);
  if (!authorization.ok) {
    logSecurityEvent("permission.denied", {
      ...context,
      userId,
      reason: authorization.reason,
      permission,
    });
    return authorization;
  }

  await touchLastSeen(userId, profile!.last_seen_at);

  return {
    ok: true,
    actor: {
      id: profile!.id,
      email: profile!.email ?? null,
      fullName: profile!.full_name,
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
