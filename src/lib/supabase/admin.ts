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
 * Currently the only caller is the login throttle (F227), whose RPCs are granted
 * to `service_role` alone — deliberately, because a counter that `anon` can
 * increment over the REST API is a way to keep a chosen account delayed without
 * ever solving a CAPTCHA.
 *
 * No session, no cookies, no token refresh: this client acts as the project, not
 * as a user, and persisting anything would risk it being mistaken for one.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Returns null rather than throwing. The key is optional locally (the same
  // arrangement as SESSION_ACTIVITY_SECRET), and the one caller treats an absent
  // client as "no throttle available" and carries on — see the fail-open note in
  // `src/lib/auth/login-throttle.ts`. Throwing here would instead take down
  // login entirely on any machine that has not set the key.
  if (!url || !key) return null;

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
