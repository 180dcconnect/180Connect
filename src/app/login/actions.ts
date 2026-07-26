"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  attemptLogin,
  normalizeEmail,
  SERVICE_UNAVAILABLE_MESSAGE,
  type LoginState,
} from "@/lib/auth/login";
import {
  ACTIVITY_COOKIE_NAME,
  activityCookieOptions,
  activitySecret,
  signActivity,
} from "@/lib/supabase/session-expiry";
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/password-reset";
import { logSecurityEvent } from "@/lib/log-security-event";

export type { LoginState };

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = normalizeEmail(formData.get("email"));

  try {
    const supabase = await createClient();
    const outcome = await attemptLogin(supabase, {
      email,
      password: formData.get("password"),
      captchaToken: formData.get("cf-turnstile-response"),
    });

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
