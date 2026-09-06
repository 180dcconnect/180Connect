"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import {
  isNotificationFrequency,
  type NotificationFrequency,
} from "@/lib/notification-preferences";
import { parseEmailNotificationTypes } from "@/lib/email-notification-preferences";

export type NotificationPreferencesState = {
  status: "idle" | "error" | "success";
  message?: string;
  frequency?: NotificationFrequency;
};

/**
 * F178 AC1 — saves the caller's own delivery frequency to
 * `users.notification_frequency` (F201, already column-granted to
 * `authenticated` since 20260828130000; `users_update_self_or_admin`
 * already permits a user to update their own row).
 *
 * No permission beyond being signed in: every role receives notifications
 * (matrix §3.19 NOTIFICATIONS is shared across all active roles), so this
 * setting is available to all of them, same gate as the accessibility page.
 */
export async function saveNotificationFrequencyAction(
  _previousState: NotificationPreferencesState,
  formData: FormData,
): Promise<NotificationPreferencesState> {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/notifications",
  });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const raw = formData.get("frequency");
  if (!isNotificationFrequency(raw)) {
    return { status: "error", message: "Choose a valid notification frequency." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ notification_frequency: raw })
    .eq("id", authorization.actor.id);

  if (error) {
    await reportError(error, { operation: "settings.notification_preferences.save" });
    return {
      status: "error",
      message: "Could not save your notification preference. Try again.",
    };
  }

  // AC3: the next time the bell mounts — any ordinary page navigation, not a
  // fresh login — it re-fetches this same row and picks up the new value;
  // this only needs to keep the settings page itself from showing stale data.
  revalidatePath("/settings/notifications");

  return { status: "success", message: "Notification preference saved.", frequency: raw };
}

export type EmailNotificationPreferencesState = {
  status: "idle" | "error" | "success";
  message?: string;
  types?: string[];
};

/**
 * F179 AC1 — saves the caller's own set of email-notified types to
 * `users.email_notification_types` (column-granted to `authenticated` by the
 * F179 migration; `users_update_self_or_admin` already permits a user to
 * update their own row).
 *
 * No permission beyond being signed in: every role can receive notifications
 * (matrix §3.19 is shared across all active roles), same gate as the
 * accessibility page.
 */
export async function saveEmailNotificationPreferencesAction(
  _previousState: EmailNotificationPreferencesState,
  formData: FormData,
): Promise<EmailNotificationPreferencesState> {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/notifications",
  });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const types = parseEmailNotificationTypes(formData.getAll("email_type"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ email_notification_types: types })
    .eq("id", authorization.actor.id);

  if (error) {
    await reportError(error, { operation: "settings.email_notification_preferences.save" });
    return {
      status: "error",
      message: "Could not save your email notification preference. Try again.",
    };
  }

  revalidatePath("/settings/notifications");

  return { status: "success", message: "Preference saved.", types };
}
