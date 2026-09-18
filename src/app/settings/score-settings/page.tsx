import { redirect } from "next/navigation";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { DEFAULT_WEIGHTS, sanitizeWeights } from "@/lib/scoring/calculate-priority-score";
import { DEFAULT_SCORING_RULES, sanitizeScoringRules } from "@/lib/scoring/scout-config";
import { inputFromStored } from "@/lib/scoring/scout-config-inputs";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Rise, Stage } from "@/components/dashboard-stage";
import { isViewOnly } from "@/lib/auth/permissions";
import { ScoreSettingsPanel } from "./score-settings-panel";

type VersionRow = {
  version: string;
  config: Record<string, unknown> | null;
  created_at: string;
  created_by: { full_name: string | null; email: string } | null;
};

/**
 * F096 — Admin Score Settings: how much each check counts, and what each check
 * rewards — the sector ranking, the branch's priority towns (one list, shared
 * with the import criteria), the in/out geography scores and the per-income-band
 * scores. Saving versions the SCOUT config (audit-logged) and the screen then
 * rescores every client in batches, showing the progress.
 *
 * Gated on `platform-settings:manage`, the same admin-only permission the save
 * action and the RPC body itself enforce.
 *
 * ── Who this is for ──
 *
 * An admin, not a developer (AGENTS.md, "Who will maintain this app"): checks,
 * rankings and towns rather than weights, factors and model versions.
 *
 * ── The layout ──
 *
 * Filed Record (`docs/app-design-system.md`), as the other settings pages.
 */
export default async function AdminScoreSettingsPage() {
  const authorization = await getViewingActor("platform-settings:manage", {
    route: "/settings/score-settings",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  // model_versions is readable by admins only (RLS policy), which is exactly
  // who reaches this page.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("model_versions")
    .select("version, config, created_at, created_by:users(full_name, email)")
    .eq("model_name", "SCOUT")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<VersionRow>();

  if (error) {
    await reportError(error, { operation: "admin.score_settings.load" });
  }

  const degraded = Boolean(error) || !data;
  const weights = data?.config?.weights ? sanitizeWeights(data.config.weights) : DEFAULT_WEIGHTS;
  const rules = data?.config ? sanitizeScoringRules(data.config) : DEFAULT_SCORING_RULES;
  const initial = inputFromStored(weights, rules);

  // How many clients still carry a score from before the active settings — an
  // interrupted update, or one saved before this screen rescored in batches.
  let totalClients = 0;
  let staleClients = 0;
  if (data) {
    const [orgs, fresh] = await Promise.all([
      supabase.from("organisations").select("id", { count: "exact", head: true }),
      supabase
        .from("latest_scores")
        .select("id", { count: "exact", head: true })
        .gte("scored_at", data.created_at),
    ]);
    if (orgs.error || fresh.error) {
      await reportError(orgs.error ?? fresh.error, { operation: "admin.score_settings.stale_count" });
    } else {
      totalClients = orgs.count ?? 0;
      staleClients = Math.max(0, totalClients - (fresh.count ?? 0));
    }
  }

  const changedBy = data?.created_by
    ? data.created_by.full_name?.trim() || data.created_by.email
    : null;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="w-full space-y-8">
        {error && (
          <Rise>
            <InlineAlert
              variant="page"
              message="The saved settings could not be loaded, so the ones below are the starting settings, not necessarily what is in use. Refresh the page before changing anything."
            />
          </Rise>
        )}

        <ScoreSettingsPanel
          initial={initial}
          totalClients={totalClients}
          staleClients={staleClients}
          readOnly={isViewOnly(authorization.actor.role)}
          degraded={degraded}
          changedBy={changedBy}
          createdAt={data?.created_at ?? null}
        />
      </Stage>
    </div>
  );
}
