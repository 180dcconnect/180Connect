"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { parseEmailNotificationTypes } from "@/lib/email-notification-preferences";

export type EmailNotificationPreferencesState = {
  status: "idle" | "error" | "success";
  message?: string;
  types?: string[];
};

/**
 * F179 AC1 — saves the caller's own set of email-notified types to
 * `users.email_notification_types` (already column-granted to `authenticated`
 * since 20260913090000; `users_update_self_or_admin` already permits a user
 * to update their own row).
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
