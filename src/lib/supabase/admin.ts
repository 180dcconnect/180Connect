import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAdminClient } from "./admin-client-factory";

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
 *
 * The actual client-building logic lives in `admin-client-factory.ts`, without
 * this file's `server-only` guard, so the ingestion runner (F038) — which runs
 * outside Next.js entirely — can reuse it without tripping a check that only
 * makes sense inside a Next.js server context.
 */
export function createAdminClient(): SupabaseClient | null {
  return buildAdminClient();
}
