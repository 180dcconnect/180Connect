"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logAuthApiHealth, logAuthError } from "@/lib/auth/observability";
import { passwordSchema, RESET_LINK_ERROR } from "@/lib/auth/password-reset";
import { createClient } from "@/lib/supabase/server";

const schema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type ResetPasswordState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: { password?: string[]; confirmPassword?: string[] };
};

export async function setNewPassword(
  _previousState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = schema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const cookieStore = await cookies();
  const recoveryUserId = cookieStore.get("180connect-password-recovery")?.value;
  if (!recoveryUserId) return { status: "error", message: RESET_LINK_ERROR };

  const startedAt = Date.now();
  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user || userData.user.id !== recoveryUserId) {
      cookieStore.delete("180connect-password-recovery");
      return { status: "error", message: RESET_LINK_ERROR };
    }

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    logAuthApiHealth("password-update", !error, startedAt, {
      error_code: error?.code,
    });
    if (error) {
      logAuthError("authentication.password_update_failed", error, {
        error_code: error.code,
      });
      return {
        status: "error",
        message:
          error.code === "same_password"
            ? "Choose a password you have not used before."
            : error.code === "weak_password"
              ? "That password does not meet the security requirements."
              : "We could not update your password. Request a new reset link and try again.",
      };
    }

    cookieStore.delete("180connect-password-recovery");
    await supabase.auth.signOut();
  } catch (error) {
    logAuthApiHealth("password-update", false, startedAt);
    logAuthError("authentication.password_update_failed", error);
    return {
      status: "error",
      message: "Password reset is temporarily unavailable. Please try again.",
    };
  }

  redirect("/login?password-reset=success");
}

