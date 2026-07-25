"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser, permissionFailureMessage } from "@/lib/auth/require-approved-user";
import { logSecurityEvent } from "@/lib/log-security-event";
import { emailField, safeValidate } from "@/lib/validation";

const allowedDomain = (process.env.AUTH_ALLOWED_EMAIL_DOMAIN ?? "180dc.org")
  .trim()
  .toLowerCase()
  .replace(/^@/, "");

const loginSchema = z.object({
  email: emailField("Enter a valid email address.").refine(
    (email) => email.endsWith(`@${allowedDomain}`),
    { message: `Use your @${allowedDomain} email address.` },
  ),
  password: z.string().min(1, "Enter your password.").max(256),
});

export type LoginState = {
  status: "idle" | "error" | "pending";
  message?: string;
  fieldErrors?: { email?: string[]; password?: string[] };
  email?: string;
};

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const result = safeValidate(loginSchema, {
    email,
    password: formData.get("password"),
  });

  if (!result.success) {
    logSecurityEvent("validation.rejected", {
      form: "login",
      fields: Object.keys(result.fieldErrors).join(","),
    });
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: result.fieldErrors,
      email,
    };
  }

  const captchaToken = String(formData.get("cf-turnstile-response") ?? "");
  if (!captchaToken) {
    // The widget has not finished, or the user submitted before it ran. Saying
    // so beats a round trip that comes back as "invalid email or password".
    logSecurityEvent("authentication.login_failed", { cause: "missing captcha token" });
    return {
      status: "error",
      message: "Complete the CAPTCHA check, then try again.",
      email,
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      ...result.data,
      options: { captchaToken },
    });

    if (error || !data.user) {
      logSecurityEvent("authentication.login_failed", {
        cause: error?.message ?? "no user returned",
      });
      // A CAPTCHA rejection is not a credentials problem, and telling the user
      // their password is wrong when it is not sends them round a loop they
      // cannot escape. Credentials stay deliberately vague either way — the
      // message never reveals whether the email exists.
      const isCaptchaFailure = /captcha/i.test(error?.message ?? "");
      return {
        status: "error",
        message: isCaptchaFailure
          ? "CAPTCHA check failed. Please try again."
          : "Invalid email or password.",
        email,
      };
    }

    const permission = requireApprovedUser(data.user);
    if (!permission.ok) {
      await supabase.auth.signOut();
      logSecurityEvent("permission.denied", {
        form: "login",
        reason: permission.reason,
      });
      return {
        status: "pending",
        message: permissionFailureMessage(permission.reason),
        email,
      };
    }
  } catch (error) {
    logSecurityEvent("authentication.login_failed", {
      cause: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      status: "error",
      message: "Login is temporarily unavailable. Please try again later.",
      email,
    };
  }

  redirect("/dashboard");
}
