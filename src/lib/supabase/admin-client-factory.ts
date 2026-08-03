import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Builds a Supabase client holding the service-role key, which bypasses row-level
 * security entirely.
 *
 * **This module deliberately has no `import "server-only"`, and that is the whole
 * reason it exists.** `server-only` throws outside a Next.js build, and the F038
 * ingestion runner runs as a plain node script, so it cannot import `./admin.ts`.
 *
 * The cost is that the guard on `admin.ts` is no longer structural — anything that
 * imports *this* file directly routes around it. So:
 *
 * - **Application code must import `createAdminClient` from `./admin.ts`**, never
 *   this file. The `no-restricted-imports` rule in `eslint.config.mjs` enforces
 *   that; only `admin.ts` and `src/lib/ingestion/**` are allowed to import this.
 * - Never import this from a Client Component. `SUPABASE_SERVICE_ROLE_KEY` is not
 *   in the `NEXT_PUBLIC_` namespace, so a browser bundle would get `undefined` and
 *   this would return null rather than leak the key — but that is a backstop, not
 *   the control.
 *
 * Returns null rather than throwing when the key is absent. The key is optional
 * locally (the same arrangement as `SESSION_ACTIVITY_SECRET`) and the callers in
 * `admin.ts` treat an absent client as "carry on without this check" — see the
 * fail-open note in `src/lib/auth/login-throttle.ts`. Throwing here would instead
 * take down login on any machine without the key. The ingestion runner, which can
 * do nothing useful without it, checks for null and raises its own error.
 *
 * No session, no cookies, no token refresh: this client acts as the project, not as
 * a user, and persisting anything would risk it being mistaken for one.
 */
export function buildAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
