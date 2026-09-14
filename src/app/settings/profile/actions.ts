"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseAccountSettings } from "@/lib/account-settings";
import { reportError } from "@/lib/error-logging";
import {
  changePasswordSchema,
  CURRENT_PASSWORD_INCORRECT,
  formString,
  type ChangePasswordState,
} from "@/lib/auth/change-password";
import { normalizeEmail } from "@/lib/auth/login";
import { createLoginThrottle, describeWait, NO_THROTTLE } from "@/lib/auth/login-throttle";
import { logAuthApiHealth, logAuthError } from "@/lib/auth/observability";
import { logSecurityEvent } from "@/lib/log-security-event";
import { safeValidate } from "@/lib/validation";

export type AccountSettingsState = {
  status: "idle" | "error" | "success";
  message?: string;
  /**
   * The name as actually stored, echoed back on success. The view row renders
   * this rather than re-deriving it from the keystrokes, so the screen cannot
   * disagree with the database about what normalisation did.
   */
  fullName?: string;
};

/**
 * Saves the caller's own display name (F200 / F201).
 *
 * Only `full_name` is written here. `notification_frequency` used to be saved
 * from this screen too, but F178 moved that setting to /settings/notifications,
 * which is now the single place it is written — this action deliberately stops
 * at the name so the column cannot be updated from a stale profile form.
 * `user_id` comes from the session rather than the form — the request cannot
 * name a different row to update, and `users_update_self_or_admin` would reject
 * it if it tried. Email and role are not read from the form at all (AC2): they
 * are displayed read-only on this screen and changed elsewhere — email through
 * login credentials, role through the admin RPC (F012).
 */
export async function saveAccountSettingsAction(
  _previousState: AccountSettingsState,
  formData: FormData,
): Promise<AccountSettingsState> {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/profile",
  });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const parsed = parseAccountSettings({
    fullName: formData.get("full_name"),
  });
  if (!parsed.ok) {
    return { status: "error", message: parsed.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({
      full_name: parsed.value.fullName,
    })
    .eq("id", authorization.actor.id);

  if (error) {
    // The message shown is deliberately generic — a Postgres error string can
    // carry column and policy names, which is more than a user needs and more
    // than we want on screen (DoD: no stack traces or internals in user-facing
    // errors). The detail goes to the error log instead.
    await reportError(error, {
      operation: "account_settings.update_profile",
      userId: authorization.actor.id,
    });
    return {
      status: "error",
      message: "Could not save your details. Try again.",
    };
  }

  // AC3: the change has to show up immediately, without a logout. The name is
  // rendered outside this page too — in the sidebar account block, which lives
  // in the shared layout — so the whole layout tree is revalidated rather than
  // just this route. That also clears the client router cache, which is what
  // would otherwise keep a stale name on screen after a client-side navigation.
  revalidatePath("/", "layout");
  revalidatePath("/settings/profile");

  return {
    status: "success",
    message: "Account details saved.",
    fullName: parsed.value.fullName,
  };
}

const CHANGE_PASSWORD_UNAVAILABLE =
  "We could not change your password. Try again.";

/**
 * Changes the signed-in user's own password.
 *
 * The current password is required and checked first. A session alone is not
 * enough: whoever holds one (an unlocked laptop, a lifted cookie) could
 * otherwise set a new password and, since every other session is signed out
 * below, lock the real owner out.
 *
 * The check is `verify_own_password` rather than a fresh `signInWithPassword`,
 * because sign-in demands a Turnstile token this form does not have — see the
 * migration header for why Supabase's `current_password` option is not used.
 * Wrong guesses count against the same F227 per-account throttle as the login
 * form, so this is not a way around its delays.
 */
export async function changePasswordAction(
  _previousState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/profile",
  });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }
  const actor = authorization.actor;

  const parsed = safeValidate(changePasswordSchema, {
    currentPassword: formString(formData.get("currentPassword")),
    password: formString(formData.get("password")),
    confirmPassword: formString(formData.get("confirmPassword")),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  try {
    const supabase = await createClient();

    // Keyed on the account's email, exactly as the login form keys it, so
    // guesses made here and there share one allowance.
    const admin = createAdminClient();
    const throttle = admin ? createLoginThrottle(admin) : NO_THROTTLE;
    const throttleKey = normalizeEmail(actor.email);

    if (throttleKey) {
      const blockedUntil = await throttle.blockedUntil(throttleKey);
      if (blockedUntil) {
        logSecurityEvent("authentication.password_change_throttled", {
          user_id: actor.id,
        });
        return {
          status: "error",
          message: `Too many incorrect attempts. Try again in ${describeWait(blockedUntil)}.`,
        };
      }
    }

    const { data: matches, error: verifyError } = await supabase.rpc(
      "verify_own_password",
      { p_password: parsed.data.currentPassword },
    );
    if (verifyError) {
      await reportError(verifyError, {
        operation: "account_settings.verify_current_password",
        userId: actor.id,
      });
      return { status: "error", message: CHANGE_PASSWORD_UNAVAILABLE };
    }

    if (matches !== true) {
      logSecurityEvent("authentication.password_change_rejected", {
        user_id: actor.id,
      });
      if (throttleKey) await throttle.recordFailure(throttleKey);
      return {
        status: "error",
        message: CURRENT_PASSWORD_INCORRECT,
        fieldErrors: { currentPassword: [CURRENT_PASSWORD_INCORRECT] },
      };
    }

    if (throttleKey) await throttle.clear(throttleKey);

    const startedAt = Date.now();
    const { error: updateError } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    logAuthApiHealth("password-change", !updateError, startedAt, {
      error_code: updateError?.code,
    });
    if (updateError) {
      logAuthError("authentication.password_update_failed", updateError, {
        error_code: updateError.code,
      });
      if (updateError.code === "same_password") {
        const message = "Choose a password different from your current one.";
        return { status: "error", message, fieldErrors: { password: [message] } };
      }
      if (updateError.code === "weak_password") {
        const message = "That password does not meet the security requirements.";
        return { status: "error", message, fieldErrors: { password: [message] } };
      }
      return { status: "error", message: CHANGE_PASSWORD_UNAVAILABLE };
    }

    // The password has changed, so nothing below may report failure — that
    // would send the user round again with what is now the right password.
    // Every *other* session is ended, so a change prompted by a suspected
    // compromise actually cuts the intruder off; this one stays signed in.
    const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
    if (signOutError) {
      logAuthError("authentication.other_sessions_revoke_failed", signOutError, {
        error_code: signOutError.code,
      });
    }
  } catch (error) {
    logAuthError("authentication.password_update_failed", error);
    return { status: "error", message: CHANGE_PASSWORD_UNAVAILABLE };
  }

  return {
    status: "success",
    message: "Password changed. You have been signed out on your other devices.",
  };
}
