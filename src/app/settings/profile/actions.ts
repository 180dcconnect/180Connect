"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import {
  parseAccountSettings,
  type NotificationFrequency,
} from "@/lib/account-settings";
import { reportError } from "@/lib/error-logging";

export type AccountSettingsState = {
  status: "idle" | "error" | "success";
  message?: string;
  /**
   * The name and notification frequency as actually stored, echoed back on success.
   */
  fullName?: string;
  notificationFrequency?: NotificationFrequency;
};

/**
 * Saves the caller's own account details (F200 / F201).
 *
 * `full_name` and `notification_frequency` are written, and `user_id` comes from
 * the session rather than the form — the request cannot name a different row to
 * update. Email and role are not read from the form at all (AC2): they are
 * displayed read-only on this screen and changed elsewhere.
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
    notificationFrequency: formData.get("notification_frequency"),
  });
  if (!parsed.ok) {
    return { status: "error", message: parsed.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({
      full_name: parsed.value.fullName,
      notification_frequency: parsed.value.notificationFrequency,
    })
    .eq("id", authorization.actor.id);

  if (error) {
    await reportError(error, {
      operation: "account_settings.update_profile_and_notifications",
      userId: authorization.actor.id,
    });
    return {
      status: "error",
      message: "Could not save your details. Try again.",
    };
  }

  // AC3: the change has to show up immediately, without a logout.
  revalidatePath("/", "layout");
  revalidatePath("/settings/profile");

  return {
    status: "success",
    message: "Account details saved.",
    fullName: parsed.value.fullName,
    notificationFrequency: parsed.value.notificationFrequency,
  };
}
