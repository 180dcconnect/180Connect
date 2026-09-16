import { redirect } from "next/navigation";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { dailySendWindowStart, DEFAULT_OUTREACH_DAILY_SEND_LIMIT } from "@/lib/outreach/daily-send-limit";
import { isViewOnly } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SendingLimitPanel } from "./sending-limit-panel";

/**
 * F128 — admin control for the branch-wide daily outreach sending cap.
 *
 * Moved from /admin/sending-limits to the settings rail (Platform section)
 * so that all platform configuration lives in one place and is reachable
 * without going back to the admin area. The permission gate is unchanged —
 * platform-settings:manage, admins only.
 */
export default async function SendingLimitsSettingsPage() {
  const authorization = await getViewingActor("platform-settings:manage", {
    route: "/settings/sending-limits",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();
  const [limitResult, volumeResult] = await Promise.all([
    supabase
      .from("outreach_daily_send_limit")
      .select("daily_limit, updated_at")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("send_status", "sent")
      .gte("sent_at", dailySendWindowStart()),
  ]);

  if (limitResult.error) {
    await reportError(limitResult.error, { operation: "settings.sending_limits.page_load" });
  }
  if (volumeResult.error) {
    await reportError(volumeResult.error, { operation: "settings.sending_limits.volume_load" });
  }

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Outreach sending limit
          </h1>
        </Rise>

        <Group className="space-y-4">
          {(limitResult.error || volumeResult.error) && (
            <Rise>
              <InlineAlert
                variant="page"
                message="Some of this page could not be loaded. Refresh and try again."
              />
            </Rise>
          )}

          <Rise>
            <SendingLimitPanel
              currentLimit={limitResult.data?.daily_limit ?? DEFAULT_OUTREACH_DAILY_SEND_LIMIT}
              sentToday={volumeResult.count ?? 0}
              updatedAt={limitResult.data?.updated_at ?? null}
              readOnly={isViewOnly(authorization.actor.role)}
            />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
