import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Stage, Rise } from "@/components/dashboard-stage";
import { CamSettingsPanel } from "./cam-settings-panel";
import {
  sanitizeQueuePreferences,
  type CamUser,
  type CamOutreachPreferences,
} from "@/lib/cam-settings";

type PageProps = {
  searchParams: Promise<{ user?: string }>;
};

export default async function AdminCamSettingsPage(props: PageProps) {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/cam-settings",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const searchParams = await props.searchParams;
  const targetUserId = searchParams.user;

  const supabase = await createClient();

  const [usersResult, preferencesResult] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, full_name, role, is_active")
      .order("full_name"),
    supabase
      .from("outreach_preferences")
      .select(
        "user_id, preferred_geographic_reach, preferred_sectors, preferred_income_bands, updated_at, created_at",
      ),
  ]);

  if (usersResult.error) {
    await reportError(usersResult.error, {
      operation: "admin.cam_settings.users_list",
    });
  }

  if (preferencesResult.error) {
    await reportError(preferencesResult.error, {
      operation: "admin.cam_settings.preferences_list",
    });
  }

  const users: CamUser[] = (usersResult.data ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: (u.role as CamUser["role"]) ?? "cam",
    is_active: Boolean(u.is_active),
  }));

  const preferencesMap: Record<string, CamOutreachPreferences> = {};
  for (const raw of preferencesResult.data ?? []) {
    const sanitized = sanitizeQueuePreferences(raw);
    if (sanitized) {
      preferencesMap[sanitized.user_id] = sanitized;
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-5xl space-y-8">
        <Rise className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
              CAM queue settings
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-[1.7] text-foreground/65">
              Inspect how team members have configured their outreach queues (F187).
              Outreach preferences filter and weight prospects by geography, organization size, and sector.
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm font-bold">
            <Link
              className="text-brand hover:underline"
              href="/admin/users"
            >
              ← Team members
            </Link>
          </div>
        </Rise>

        {(usersResult.error || preferencesResult.error) && (
          <Rise>
            <p
              className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive"
              role="alert"
            >
              Some settings data could not be loaded. Please refresh and try again.
            </p>
          </Rise>
        )}

        <CamSettingsPanel
          users={users}
          preferencesMap={preferencesMap}
          initialSelectedUserId={targetUserId}
        />
      </Stage>
    </div>
  );
}
