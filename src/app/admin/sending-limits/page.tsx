import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { dailySendWindowStart, DEFAULT_OUTREACH_DAILY_SEND_LIMIT } from "@/lib/outreach/daily-send-limit";
import { createClient } from "@/lib/supabase/server";
import { SendingLimitPanel } from "./sending-limit-panel";

/** F128 — admin control for the branch-wide daily outreach sending cap. */
export default async function SendingLimitsPage() {
  const authorization = await getCurrentActor("platform-settings:manage", {
    route: "/admin/sending-limits",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();
  const [limitResult, volumeResult] = await Promise.all([
    supabase.from("outreach_daily_send_limit").select("daily_limit, updated_at").eq("id", true).maybeSingle(),
    supabase
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("send_status", "sent")
      .gte("sent_at", dailySendWindowStart()),
  ]);

  if (limitResult.error) {
    await reportError(limitResult.error, { operation: "admin.sending_limits.page_load" });
  }
  if (volumeResult.error) {
    await reportError(volumeResult.error, { operation: "admin.sending_limits.volume_load" });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Outreach sending limit</h1>
        <p className="mt-3 text-sm text-foreground/65">
          A cap on how many outreach emails the branch mailbox sends per UTC calendar
          day, across every CAM combined (F128). A CAM attempting to send once the cap
          is reached sees a clear message and nothing goes out. Changes take effect on
          the next send attempt, with no code change or redeploy.
        </p>

        {(limitResult.error || volumeResult.error) && (
          <p className="mt-4 text-sm font-bold text-red-800" role="alert">
            Some of this page could not be loaded. Refresh and try again.
          </p>
        )}

        <SendingLimitPanel
          currentLimit={limitResult.data?.daily_limit ?? DEFAULT_OUTREACH_DAILY_SEND_LIMIT}
          sentToday={volumeResult.count ?? 0}
          updatedAt={limitResult.data?.updated_at ?? null}
        />
      </section>
    </main>
  );
}
