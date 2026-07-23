"use server";

import { headers } from "next/headers";
import {
  emailSchema,
  RESET_REQUEST_MESSAGE,
} from "@/lib/auth/password-reset";
import {
  logAuthApiHealth,
  logAuthError,
} from "@/lib/auth/observability";
import { createClient } from "@/lib/supabase/server";

export type ForgotPasswordState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: { email?: string[] };
  email?: string;
};

async function recoveryRedirectUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configuredUrl) return `${configuredUrl}/auth/recovery`;

  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (
    origin &&
    (process.env.NODE_ENV !== "production" ||
      origin.startsWith("https://"))
  ) {
    return `${origin}/auth/recovery`;
  }

  throw new Error("NEXT_PUBLIC_APP_URL is not configured.");
}

export async function requestPasswordReset(
  _previousState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const parsed = emailSchema.safeParse(email);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted field and try again.",
      fieldErrors: { email: parsed.error.issues.map((issue) => issue.message) },
      email,
    };
  }

  const startedAt = Date.now();
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: await recoveryRedirectUrl(),
    });

    logAuthApiHealth("password-reset-request", !error, startedAt, {
      error_code: error?.code,
    });

    // Deliberately return the same response for unknown, inactive, rate-limited,
    // and registered accounts to prevent account enumeration.
    if (error) {
      logAuthError("authentication.password_reset_request_failed", error, {
        error_code: error.code,
      });
    }
  } catch (error) {
    logAuthApiHealth("password-reset-request", false, startedAt);
    logAuthError("authentication.password_reset_request_failed", error);
  }

  return {
    status: "success",
    message: RESET_REQUEST_MESSAGE,
  };
}

