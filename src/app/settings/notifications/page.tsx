import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { isNotificationFrequency } from "@/lib/notification-preferences";
import { NotificationFrequencyForm } from "./notification-frequency-form";
import {
  DEFAULT_EMAIL_NOTIFICATION_TYPES,
  parseEmailNotificationTypes,
} from "@/lib/email-notification-preferences";
import { EmailNotificationsForm } from "./email-notifications-form";

/**
 * One notification-preferences page for both preferences:
 *
 * F178 — how eagerly the notification bell (F173) interrupts the signed-in
 * user: immediate, daily digest, or weekly digest (AC1).
 * `users.notification_frequency` already exists and is already writable by
 * its owner (F201, 20260828130000_add_notification_frequency_and_followup_timing.sql).
 *
 * F179 — which notification types should *also* arrive by email, "in
 * addition to in-app" (AC1). `users.email_notification_types` defaults to
 * `{client_reply_received}` at the column level (AC3), so a CAM who never
 * opens this page still gets reply emails unless they explicitly come here
 * and uncheck the box. The email preference lives on the same page as the
 * frequency preference — F179's own dependency list names F178 — rather
 * than a second, competing "notifications" route.
 */
export default async function NotificationSettingsPage() {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/notifications",
  });
  if (!authorization.ok) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("notification_frequency, email_notification_types")
    .eq("id", authorization.actor.id)
    .maybeSingle<{ notification_frequency: string; email_notification_types: string[] | null }>();

  if (error) {
    await reportError(error, { operation: "settings.notification_preferences.page_load" });
  }

  const initialFrequency = isNotificationFrequency(data?.notification_frequency)
    ? data.notification_frequency
    : "immediate";

  // `null` (never stored) falls back to the column default so the form
  // agrees with what the database will actually do; an explicit `[]`
  // (opted out of email) is preserved as-is.
  const initialEmailTypes = data?.email_notification_types
    ? parseEmailNotificationTypes(data.email_notification_types)
    : DEFAULT_EMAIL_NOTIFICATION_TYPES;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-2xl space-y-10">
        <Rise>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Notification preferences
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
            Notifications are always recorded and always visible when you check the
            bell. These settings only control how eagerly one interrupts you — and
            which ones are also emailed to you, so something urgent doesn&apos;t sit
            unread while you&apos;re away.
          </p>
        </Rise>

        {error ? (
          <Rise>
            <InlineAlert
              variant="page"
              message="Your notification preferences could not be loaded. Please refresh and try again."
            />
          </Rise>
        ) : (
          <>
            <Rise>
              <NotificationFrequencyForm initialFrequency={initialFrequency} />
            </Rise>
            <Rise>
              <EmailNotificationsForm initialTypes={initialEmailTypes} />
            </Rise>
          </>
        )}
      </Stage>
    </div>
  );
}
