import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { isNotificationFrequency } from "@/lib/notification-preferences";
import { NotificationFrequencyForm } from "./notification-frequency-form";

/**
 * F178 — lets any signed-in user choose how eagerly the notification bell
 * (F173) interrupts them: immediate, daily digest, or weekly digest (AC1).
 * `users.notification_frequency` already exists and is already writable by
 * its owner (F201, 20260828130000_add_notification_frequency_and_followup_timing.sql)
 * — this page is the first thing that actually reads and writes it.
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
    .select("notification_frequency")
    .eq("id", authorization.actor.id)
    .maybeSingle<{ notification_frequency: string }>();

  if (error) {
    await reportError(error, { operation: "settings.notification_preferences.page_load" });
  }

  const initialFrequency = isNotificationFrequency(data?.notification_frequency)
    ? data.notification_frequency
    : "immediate";

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-2xl space-y-10">
        <Rise>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Notification preferences
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
            Choose how eagerly the notification bell interrupts you. Notifications are
            always recorded and always visible when you check — this only controls
            whether you&apos;re alerted the moment one arrives.
          </p>
        </Rise>

        {error ? (
          <Rise>
            <InlineAlert
              variant="page"
              message="Your notification preference could not be loaded. Please refresh and try again."
            />
          </Rise>
        ) : (
          <Rise>
            <NotificationFrequencyForm initialFrequency={initialFrequency} />
          </Rise>
        )}
      </Stage>
    </div>
  );
}
