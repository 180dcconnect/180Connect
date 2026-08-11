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
    fullName: formData.get("fullName"),
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
  let currentFullName: string | null = null;
  let submittedFullName = "";
  try {
    supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    // The marker proves nothing without the session it was issued alongside,
    // and that session must still belong to the user it names.
    if (userError || !userData.user || userData.user.id !== recoveryUserId) {
      cookieStore.delete(RECOVERY_COOKIE_NAME);
      return { status: "error", message: RESET_LINK_ERROR };
    }

    // A name is only required here if the account does not already have one —
    // an invite acceptance (F008), where nothing has ever set it, rather than
    // an ordinary password reset for a named user. State, not flow identity,
    // decides this, same as `mark_invite_accepted` deciding by column state
    // below rather than by which link type was clicked.
    const { data: profileRow } = await supabase
      .from("users")
      .select("full_name")
      .eq("id", recoveryUserId)
      .maybeSingle();
    currentFullName = profileRow?.full_name?.trim() || null;
    submittedFullName = parsed.data.fullName?.trim() || "";
    if (!currentFullName && !submittedFullName) {
      return {
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: { fullName: ["Enter your name to finish setting up your account."] },
      };
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

  if (submittedFullName && submittedFullName !== currentFullName) {
    const { error: nameError } = await supabase
      .from("users")
      .update({ full_name: submittedFullName })
      .eq("id", recoveryUserId);
    if (nameError) {
      logAuthError("user.full_name_update_failed", nameError);
    }
  }

  // Read before mark_invite_accepted runs, so the redirect below can tell a
  // first-time invite acceptance apart from an ordinary password reset.
  // mark_invite_accepted() itself knows the difference internally but returns
  // void either way (supabase/migrations/20260804090000_add_user_invite_tracking.sql)
  // — it exists to be called blindly from the shared reset path, not to report
  // back what it did. A plain read of the same columns it acts on is enough,
  // and does not require touching that RPC's signature. If the read fails for
  // any reason, this falls back to the password-reset copy — the safe default,
  // and not worth blocking the redirect over.
  const { data: profile } = await supabase
    .from("users")
    .select("invited_at, invite_accepted_at")
    .eq("id", recoveryUserId)
    .maybeSingle<{ invited_at: string | null; invite_accepted_at: string | null }>();
  const isInviteAcceptance = Boolean(profile?.invited_at) && !profile?.invite_accepted_at;

  // Setting a first password is what accepts an invite (F008) — not clicking the
  // emailed link, which only proves the mailbox is readable. This is the shared
  // landing for recovery and invites, and the RPC is a no-op for anyone without a
  // pending invite, so it is called unconditionally rather than trying to tell the
  // two apart here. Must run before signOutAndReport, which ends the session it
  // authorises against. A failure leaves the invite showing as pending, which the
  // admin can see and act on — better than blocking a password that already changed.
  const { error: acceptError } = await supabase.rpc("mark_invite_accepted");
  if (acceptError) {
    logAuthError("user.invite_accept_failed", acceptError);
  }

  // Revoke every other session, so a reset prompted by a suspected compromise
  // actually ends the intruder's access. `signOutAndReport` records a failure
  // rather than throwing (F006) — the redirect below has to happen either way.
  await signOutAndReport(supabase);

  redirect(isInviteAcceptance ? "/login?invite-accepted=success" : "/login?password-reset=success");
}
