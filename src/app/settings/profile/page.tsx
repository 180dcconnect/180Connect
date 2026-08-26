import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { Rise, Stage } from "@/components/dashboard-stage";
import { ProfilePanel } from "./profile-panel";
import type { NotificationFrequency } from "@/lib/account-settings";

/**
 * Profile (F015) and account settings (F200 / F201) are one screen, not two:
 * the display name, read-only auth details, and notification delivery frequency
 * are configured together here. The same three fields were on both, and a
 * second copy of a field is how two controls for it drift apart. This is the
 * view; the display name opens in place.
 */
export default async function ProfileSettingsPage() {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/profile",
  });
  if (!authorization.ok) {
    redirect("/login");
  }

  // No permission argument: every signed-in role has a profile to maintain, and
  // the write is confined to the caller's own row by RLS rather than by a role
  // check here.
  const actor = authorization.actor;
  const supabase = await createClient();
  const { data: userRow } = await supabase
    .from("users")
    .select("notification_frequency")
    .eq("id", actor.id)
    .maybeSingle<{ notification_frequency: NotificationFrequency | null }>();

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-2xl space-y-10">
        <Rise>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Profile & Account
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
            Manage your display details and notification delivery preferences.
          </p>
        </Rise>

        <Rise>
          <ProfilePanel
            initialFullName={actor.fullName ?? ""}
            initialNotificationFrequency={userRow?.notification_frequency ?? "immediate"}
            email={actor.email}
            role={actor.role}
          />
        </Rise>
      </Stage>
    </div>
  );
}
