"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readUserActiveStatus } from "@/lib/supabase/admin";
import {
  allowedEmailDomains,
  attemptLogin,
  normalizeEmail,
  SERVICE_UNAVAILABLE_MESSAGE,
} from "@/lib/auth/login";
import { createLoginThrottle, NO_THROTTLE } from "@/lib/auth/login-throttle";
import type { LoginState } from "@/lib/auth/login";
import {
  ACTIVITY_COOKIE_NAME,
  activityCookieOptions,
  activitySecret,
  signActivity,
} from "@/lib/supabase/session-expiry";
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/password-reset";
import { logSecurityEvent } from "@/lib/log-security-event";

// No `export type { LoginState }` here on purpose. A "use server" module may
// only export async functions, and Turbopack turns a type re-export into a
// runtime one — which blows up on the client as "LoginState is not defined",
// intermittently, because it depends on how the module was last rebuilt.
// Consumers import the type from `@/lib/auth/login`, where it is declared.

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = normalizeEmail(formData.get("email"));

  try {
    const supabase = await createClient();

    // The throttle (F227) runs as service_role, because its RPCs are granted to
    // nobody else — a counter `anon` could increment over the REST API would be a
    // way to keep a chosen account delayed without solving a CAPTCHA. With no
    // service-role key configured it degrades to the no-op rather than blocking
    // login; see the fail-open note in `@/lib/auth/login-throttle`.
    const admin = createAdminClient();
    const throttle = admin ? createLoginThrottle(admin) : NO_THROTTLE;

    const outcome = await attemptLogin(
      supabase,
      {
        email,
        password: formData.get("password"),
        captchaToken: formData.get("cf-turnstile-response"),
      },
      allowedEmailDomains(),
      throttle,
      // F013: reads users.is_active bypassing RLS, which the signed-in client
      // cannot do for a suspended user — their own row is invisible to them.
      readUserActiveStatus,
    );

    if (!outcome.ok) {
      return outcome.state;
    }

    // Start the inactivity window (F007). Expiry fails closed, so a session
    // that never gets this first record is expired on its very next request —
    // signing in is where the record has to come from.
    const cookieStore = await cookies();
    cookieStore.set(
      ACTIVITY_COOKIE_NAME,
      await signActivity(Date.now(), activitySecret()),
      activityCookieOptions(),
    );

    // Signing in ends any password reset that was in flight (F004). An
    // abandoned reset leaves its marker behind for up to an hour, and the
    // session guard confines every session carrying one to /reset-password —
    // so without this, a user who gave up on the reset and logged in normally
    // would be bounced straight back to the form they walked away from.
    cookieStore.delete(RECOVERY_COOKIE_NAME);
  } catch (error) {
    // Reachable when the Supabase client cannot be built (missing environment
    // variables) or the activity cookie cannot be written. `attemptLogin`
    // handles its own failures and does not throw.
    logSecurityEvent("authentication.login_failed", {
      cause: error instanceof Error ? error.message : "Unknown error",
    });
    return { status: "error", message: SERVICE_UNAVAILABLE_MESSAGE, email };
  }

  redirect("/dashboard");
}
