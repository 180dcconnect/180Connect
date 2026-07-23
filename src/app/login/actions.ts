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

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword(result.data);

    if (error || !data.user) {
      logSecurityEvent("authentication.login_failed", {
        cause: error?.message ?? "no user returned",
      });
      return {
        status: "error",
        message: "Invalid email or password.",
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
