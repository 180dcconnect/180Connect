import type { SupabaseClient } from "@supabase/supabase-js";

import { reportError } from "./error-logging.ts";
import { wantsEmailNotification } from "./email-notification-preferences.ts";
import { sendNotificationEmail } from "./notification-email.ts";

/**
 * The email half of a notification, for producers that run in TypeScript:
 * looks the recipient up and sends only if they are active and have opted in
 * to this type on Settings → Notifications.
 *
 * Call it after the in-app notification has been created. Best-effort, like
 * `notifyReplyOwnerByEmail` in reply-sync.ts: every failure is reported and
 * swallowed, because the in-app notification already exists and a sweep or a
 * scheduled send must never fail over an email.
 *
 * Imports `server-only` through notification-email.ts, so producers that are
 * also loaded by the Node test runner import this lazily.
 */
export async function emailNotificationIfWanted(
  admin: SupabaseClient,
  input: {
    recipientUserId: string;
    notificationType: string;
    subject: string;
    text: string;
    operation: string;
  },
): Promise<void> {
  try {
    const { data: recipient, error } = await admin
      .from("users")
      .select("email, is_active, email_notification_types")
      .eq("id", input.recipientUserId)
      .maybeSingle<{
        email: string;
        is_active: boolean;
        email_notification_types: string[] | null;
      }>();
    if (error) throw error;
    if (!recipient?.is_active || !recipient.email) return;
    if (!wantsEmailNotification(recipient.email_notification_types, input.notificationType)) {
      return;
    }

    const result = await sendNotificationEmail({
      to: recipient.email,
      subject: input.subject,
      text: input.text,
    });
    if (!result.ok) {
      await reportError(new Error(result.reason), {
        operation: input.operation,
        recipientUserId: input.recipientUserId,
      });
    }
  } catch (error) {
    await reportError(error, {
      operation: input.operation,
      recipientUserId: input.recipientUserId,
    });
  }
}
