import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role Supabase client (F013).
 *
 * Distinct from `createClient()` in ./server.ts in the way that matters: this one
 * carries SUPABASE_SERVICE_ROLE_KEY, so it BYPASSES ROW-LEVEL SECURITY ENTIRELY.
 * Every policy in the database is inert against it. Reach for it only where the
 * work genuinely cannot be done as the signed-in user, and keep the call site
 * behind its own authorisation check.
 *
 * Today there is exactly one such place: reading `users.is_active` during login,
 * before the caller has a session that any policy would accept.
 *
 * Session revocation used to live here too, and could not: `auth.admin.signOut`
 * takes a JWT, not a user id, and GoTrue exposes no by-user-id logout endpoint at
 * all. It is now done in the database, inside `set_user_active` itself — see
 * `supabase/migrations/20260729232500_revoke_sessions_on_suspend.sql`.
 *
 * Never import this from a Client Component. `server-only` makes that a build
 * error rather than a leaked key.
 */

/** Thrown rather than returned: a missing key is a deployment fault, not a user error. */
export class ServiceRoleUnavailableError extends Error {
  constructor() {
    super("SUPABASE_SERVICE_ROLE_KEY is not configured.");
    this.name = "ServiceRoleUnavailableError";
  }
}

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new ServiceRoleUnavailableError();
  }

  // No cookie handling and no session persistence: this client is not acting for
  // anybody. autoRefreshToken off for the same reason — there is no session to
  // refresh, and leaving it on starts a timer in a request-scoped client.
  return createSupabaseClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Reads `users.is_active` for one user, bypassing RLS (F013).
 *
 * The login path needs this because `users_select_active` gates SELECT on the
 * *reader* being active: a suspended user asking for their own row gets nothing
 * back, which is indistinguishable from having no profile row at all.
 *
 * `null` means the answer could not be obtained — a missing service-role key, or a
 * failed query. Callers treat that as "carry on": the dashboard's `getCurrentActor`
 * check is the one that actually holds, and it reads the same column.
 */
export async function readUserActiveStatus(userId: string): Promise<boolean | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("users")
      .select("is_active")
      .eq("id", userId)
      .maybeSingle<{ is_active: boolean }>();

    if (error || !data) return null;
    return data.is_active;
  } catch {
    return null;
  }
}

/*
 * `revokeUserSessions` was here. It called `auth.admin.signOut(userId, 'global')`,
 * whose first parameter is a JWT and not a user id — auth-js sends it as the bearer
 * token on POST /logout, so GoTrue rejected every call with "invalid JWT ... token
 * contains an invalid number of segments" and no suspension ever revoked anything.
 * There is no by-user-id logout endpoint to correct it to (GoTrue v2.193.1 returns
 * 404 for /admin/users/{id}/logout and /admin/users/{id}/sessions), so revocation
 * moved into the database: `set_user_active` now deletes the user's `auth.sessions`
 * rows in the same transaction as the flag flip. Atomic, and it needs no service key.
 */
