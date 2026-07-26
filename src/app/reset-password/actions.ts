"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logAuthApiHealth, logAuthError } from "@/lib/auth/observability";
import {
  newPasswordSchema,
  RECOVERY_COOKIE_NAME,
  readRecoveryMarker,
  RESET_LINK_ERROR,
} from "@/lib/auth/password-reset";
import type { ResetPasswordState } from "@/lib/auth/password-reset";
import { signOutAndReport } from "@/lib/auth/sign-out";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";

export async function setNewPassword(
  _previousState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = safeValidate(newPasswordSchema, {
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const cookieStore = await cookies();

  // The marker is signed, so a session holder cannot mint one for themselves
  // and change a password without going through the emailed link — see
  // `src/lib/auth/password-reset.ts`. An unverifiable marker reads as absent.
  const recoveryUserId = await readRecoveryMarker(
    cookieStore.get(RECOVERY_COOKIE_NAME)?.value,
  );
  if (!recoveryUserId) return { status: "error", message: RESET_LINK_ERROR };

  let supabase;
  try {
    supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    // The marker proves nothing without the session it was issued alongside,
    // and that session must still belong to the user it names.
    if (userError || !userData.user || userData.user.id !== recoveryUserId) {
      cookieStore.delete(RECOVERY_COOKIE_NAME);
      return { status: "error", message: RESET_LINK_ERROR };
    }

    const startedAt = Date.now();
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
  } catch (error) {
    logAuthError("authentication.password_update_failed", error);
    return {
      status: "error",
      message: "Password reset is temporarily unavailable. Please try again.",
    };
  }

  // Past this point the password *has* changed, so nothing below may report a
  // failure to the user: telling them it did not work would send them round
  // again with the password that is now the right one.
  cookieStore.delete(RECOVERY_COOKIE_NAME);

  // Revoke every other session, so a reset prompted by a suspected compromise
  // actually ends the intruder's access. `signOutAndReport` records a failure
  // rather than throwing (F006) — the redirect below has to happen either way.
  await signOutAndReport(supabase);

  redirect("/login?password-reset=success");
}
