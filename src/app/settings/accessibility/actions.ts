"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import {
  ACCESSIBILITY_FIELDS,
  parseAccessibilitySettings,
  settingsFromAccountJson,
  type AccessibilityInput,
  type AccessibilitySettings,
} from "@/lib/accessibility";

export type AccessibilityFormState = {
  /** `partial`: saved to this browser, but the account write failed. */
  status: "idle" | "error" | "success" | "partial";
  message?: string;
  settings?: AccessibilitySettings;
};

/**
 * Persists accessibility settings (F205) to cookies — which the root layout
 * reads to paint `<html>` with no flash — and to `users.accessibility_settings`,
 * so they follow the account to other devices (see accessibility-account-sync).
 */
export async function saveAccessibilitySettingsAction(
  _previousState: AccessibilityFormState,
  formData: FormData,
): Promise<AccessibilityFormState> {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/accessibility",
  });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const input: AccessibilityInput = {};
  for (const field of ACCESSIBILITY_FIELDS) input[field.key] = formData.get(field.key);
  const parsed = parseAccessibilitySettings(input);
  if (!parsed.ok) {
    return { status: "error", message: parsed.message };
  }

  const cookieStore = await cookies();
  const cookieOptions = {
    path: "/",
    maxAge: 31536000, // 1 year
    sameSite: "lax" as const,
  };
  for (const field of ACCESSIBILITY_FIELDS) {
    cookieStore.set(field.cookie, parsed.value[field.key], cookieOptions);
  }

  // Own row only: column-granted to `authenticated` by
  // 20261004110000_add_users_accessibility_settings.sql, row-scoped by the
  // existing users_update_self_or_admin policy.
  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ accessibility_settings: parsed.value })
    .eq("id", authorization.actor.id);

  revalidatePath("/", "layout");

  if (error) {
    await reportError(error, { operation: "settings.accessibility.save_account" });
    return {
      status: "partial",
      message: "Saved to this browser, but not to your account — other devices won't get it yet.",
      settings: parsed.value,
    };
  }

  return {
    status: "success",
    message: "Saved to your account.",
    settings: parsed.value,
  };
}

export type AccountAccessibilityResult =
  | { status: "ok"; settings: AccessibilitySettings | null }
  | { status: "unavailable" };

/**
 * The signed-in user's stored settings, or null if they have never saved any.
 *
 * `unavailable` on any failure, unreported: the likeliest cause is an
 * environment the migration has not reached, and the right behaviour there is
 * to carry on with cookies rather than log an error on every tab.
 */
export async function loadAccountAccessibilityAction(): Promise<AccountAccessibilityResult> {
  const authorization = await getCurrentActor();
  if (!authorization.ok) return { status: "unavailable" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("accessibility_settings")
    .eq("id", authorization.actor.id)
    .maybeSingle<{ accessibility_settings: unknown }>();

  if (error) return { status: "unavailable" };
  return { status: "ok", settings: settingsFromAccountJson(data?.accessibility_settings) };
}
