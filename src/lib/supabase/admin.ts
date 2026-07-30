import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client holding the service-role key.
 *
 * The service role bypasses row-level security, so this must never be reachable
 * from the browser: `server-only` above makes importing it from a Client
 * Component a build error rather than a leak. It is also why the key is read
 * from `SUPABASE_SERVICE_ROLE_KEY` and not the `NEXT_PUBLIC_` namespace.
 *
 * Two callers, both on the login path and both for the same underlying reason —
 * the work has to happen before the caller has a session any policy would accept:
 *
 *   - the login throttle (F227), whose RPCs are granted to `service_role` alone,
 *     deliberately, because a counter that `anon` can increment over the REST API
 *     is a way to keep a chosen account delayed without ever solving a CAPTCHA;
 *   - `readUserActiveStatus` (F013), because `users_select_active` gates SELECT on
 *     the *reader* being active, so a suspended user cannot read their own row.
 *
 * No session, no cookies, no token refresh: this client acts as the project, not
 * as a user, and persisting anything would risk it being mistaken for one.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Returns null rather than throwing. The key is optional locally (the same
  // arrangement as SESSION_ACTIVITY_SECRET), and both callers treat an absent
  // client as "carry on without this check" — see the fail-open note in
  // `src/lib/auth/login-throttle.ts`, and `readUserActiveStatus` below. Throwing
  // here would instead take down login entirely on any machine without the key.
  if (!url || !key) return null;

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
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
    if (!admin) return null;

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
