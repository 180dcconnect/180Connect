"use server";

import { headers } from "next/headers";
import { emailSchema, RESET_REQUEST_MESSAGE } from "@/lib/auth/password-reset";
import { logAuthApiHealth, logAuthError } from "@/lib/auth/observability";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";

export type ForgotPasswordState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: { email?: string[] };
  email?: string;
};

/**
 * Where the emailed link should land.
 *
 * `NEXT_PUBLIC_APP_URL` is required (`src/lib/env.ts`) and is the only source
 * that is right in every environment. The `origin` fallback exists for local
 * work; in production an unset variable is a misconfiguration, not something to
 * paper over with an attacker-supplied header.
 */
async function recoveryRedirectUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configuredUrl) return `${configuredUrl}/auth/recovery`;

  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (origin && process.env.NODE_ENV !== "production") {
    return `${origin}/auth/recovery`;
  }

  throw new Error("NEXT_PUBLIC_APP_URL is not configured.");
}

export async function requestPasswordReset(
  _previousState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const parsed = safeValidate(emailSchema, email);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted field and try again.",
      // A bare string schema reports under the root key rather than a field.
      fieldErrors: { email: parsed.fieldErrors[""] ?? ["Enter a valid email address."] },
      email,
    };
  }

  // This endpoint makes Supabase send mail to an address the caller chose, so
  // it gets the same CAPTCHA the login form does (F003). Without one, anyone
  // can drive the project's outbound email quota flat and deny real resets.
  const captchaToken = String(formData.get("cf-turnstile-response") ?? "");
  if (!captchaToken) {
    return {
      status: "error",
      message: "Complete the CAPTCHA check, then try again.",
      email,
    };
  }

  // Resolved before the neutral-response block below. A missing app URL is a
  // deployment fault, not a fact about this email address, and reporting it as
  // "we've sent instructions" would hide a total outage of the feature behind a
  // reassuring message.
  const redirectTo = await recoveryRedirectUrl();

  const startedAt = Date.now();
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo,
      captchaToken,
    });

    logAuthApiHealth("password-reset-request", !error, startedAt, {
      error_code: error?.code,
    });

    // Deliberately return the same response for unknown, inactive, rate-limited
    // and registered accounts, so this form cannot be used to discover who has
    // an account.
    if (error) {
      logAuthError("authentication.password_reset_request_failed", error, {
        error_code: error.code,
      });
    }
  } catch (error) {
    logAuthApiHealth("password-reset-request", false, startedAt);
    logAuthError("authentication.password_reset_request_failed", error);
  }

  return { status: "success", message: RESET_REQUEST_MESSAGE };
}
