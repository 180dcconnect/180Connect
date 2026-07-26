"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  attemptLogin,
  normalizeEmail,
  SERVICE_UNAVAILABLE_MESSAGE,
  type LoginState,
} from "@/lib/auth/login";
import { logSecurityEvent } from "@/lib/log-security-event";

export type { LoginState };

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = normalizeEmail(formData.get("email"));

  let outcome;
  try {
    const supabase = await createClient();
    outcome = await attemptLogin(supabase, {
      email,
      password: formData.get("password"),
      captchaToken: formData.get("cf-turnstile-response"),
    });
  } catch (error) {
    // Only reachable when the Supabase client cannot be built at all — missing
    // environment variables. `attemptLogin` handles its own failures.
    logSecurityEvent("authentication.login_failed", {
      cause: error instanceof Error ? error.message : "Unknown error",
    });
    return { status: "error", message: SERVICE_UNAVAILABLE_MESSAGE, email };
  }

  if (!outcome.ok) {
    return outcome.state;
  }

  redirect("/dashboard");
}
