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
 * Today there is exactly one such place: revoking a suspended user's sessions.
 * `auth.admin.signOut(userId)` is an Admin API call and there is no user-scoped
 * equivalent — a signed-in admin cannot end somebody else's session.
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

/**
 * Revokes every session belonging to `userId`, so a suspension takes effect on
 * the access token and not only in the database (F013 AC2).
 *
 * Flipping `is_active` already denies the user all data: every RLS policy gates on
 * `app.is_active_user()`. What it cannot do is invalidate an access token that has
 * already been issued — without this call the suspended user keeps a working token,
 * and therefore a logged-in-looking shell, until it expires.
 *
 * Returns `ok: false` instead of throwing. The caller has, by this point, already
 * suspended the user; that part is done and must not be reported as a failure just
 * because the session sweep did not land.
 */
export async function revokeUserSessions(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    const admin = createAdminClient();
    // 'global' — every session on every device, not just the current one.
    const { error } = await admin.auth.admin.signOut(userId, "global");
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
