import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { EmailNotificationsForm } from "./email-notifications-form";

/**
 * F179 — lets any signed-in user choose which notification types also
 * arrive by email, "in addition to in-app" (AC1). Every notification still
 * lands in-app regardless of this setting; checking a box here only adds an
 * email on top. `users.email_notification_types` defaults to
 * `{reply_received}` at the column level (AC3), so a CAM who never opens
 * this page still gets reply emails unless they explicitly come here and
 * uncheck it.
 */
export default async function NotificationEmailSettingsPage() {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/notifications",
  });
  if (!authorization.ok) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("email_notification_types")
    .eq("id", authorization.actor.id)
    .maybeSingle<{ email_notification_types: string[] | null }>();

  if (error) {
    await reportError(error, { operation: "settings.email_notification_preferences.page_load" });
  }

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-2xl space-y-10">
        <Rise>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Notification emails
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
            Notifications always appear in-app. Choose which ones should also arrive by
            email, so something urgent doesn&apos;t sit unread while you&apos;re away.
          </p>
        </Rise>

        {error ? (
          <Rise>
            <InlineAlert
              variant="page"
              message="Your email notification preference could not be loaded. Please refresh and try again."
            />
          </Rise>
        ) : (
          <Rise>
            <EmailNotificationsForm initialTypes={data?.email_notification_types ?? []} />
          </Rise>
        )}
      </Stage>
    </div>
  );
}
