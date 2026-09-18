import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { isNotificationFrequency } from "@/lib/notification-preferences";
import { notificationsForAbilities } from "@/lib/notification-catalogue";
import {
  DEFAULT_EMAIL_NOTIFICATION_TYPES,
  parseEmailNotificationTypes,
} from "@/lib/email-notification-preferences";
import { NotificationPreferencesForm } from "./preferences-form";

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
 * and uncheck the box.
 *
 * Same skeleton as Profile & account and Accessibility: heading, one rail of
 * facts, cards, one save bar — Filed Record tokens (`docs/app-design-system.md`).
 * The notification list comes from `src/lib/notification-catalogue.ts`,
 * filtered to what this role can actually receive.
 */
export default async function NotificationSettingsPage() {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/notifications",
  });
  if (!authorization.ok) {
    redirect("/login");
  }
  const actor = authorization.actor;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("notification_frequency, email_notification_types")
    .eq("id", actor.id)
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

  const notifications = notificationsForAbilities({
    canEditClients: hasPermission(actor.role, "client:edit"),
    isAdmin: hasPermission(actor.role, "user:manage"),
  });

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Notifications
          </h1>
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-go" />
            <span>
              Everything arrives in the bell
              {actor.email ? (
                <>
                  {" "}
                  · emails go to <span className="text-ink">{actor.email}</span>
                </>
              ) : null}
            </span>
          </p>
        </Rise>

        <Group>
          <Rise>
            {error ? (
              <InlineAlert
                variant="page"
                message="Your notification preferences could not be loaded. Please refresh and try again."
              />
            ) : (
              <NotificationPreferencesForm
                initialFrequency={initialFrequency}
                initialEmailTypes={initialEmailTypes}
                notifications={notifications}
                email={actor.email}
              />
            )}
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
