import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import {
  DEFAULT_WEIGHTS,
  sanitizeWeights,
} from "@/lib/scoring/calculate-priority-score";
import { toPercentages, type ScoutWeightsInput } from "@/lib/scoring/scout-weight-inputs";
import { Stage, Rise } from "@/components/dashboard-stage";
import { ScoreSettingsPanel } from "./score-settings-panel";

type VersionRow = {
  version: string;
  config: { weights?: Record<string, unknown> } | null;
};

/**
 * F096 — Admin Score Settings. Admins tune the relative weight of each scoring
  * parameter; saving versions the SCOUT config (audit-logged) and rescores the
 * whole book under the new weights.
 *
 * Gated on `platform-settings:manage`, the same admin-only permission the save
 * action and the RPC body itself enforce — three layers saying the same thing,
 * because each one catches a different way past the others.
 */
export default async function AdminScoreSettingsPage() {
  const authorization = await getCurrentActor("platform-settings:manage", {
    route: "/admin/score-settings",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  // model_versions is readable by admins only (RLS policy), which is exactly
  // who reaches this page; a non-admin who gets here via a stale session just
  // sees the error banner below rather than weights.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("model_versions")
    .select("version, config")
    .eq("model_name", "SCOUT")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<VersionRow>();

  if (error) {
    await reportError(error, { operation: "admin.score_settings.load" });
  }

  const degraded = Boolean(error) || !data;
  const weights = data?.config?.weights
    ? sanitizeWeights(data.config.weights)
    : DEFAULT_WEIGHTS;

  const activeWeights: ScoutWeightsInput = toPercentages(weights);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-5xl space-y-8">
        <Rise className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
              Score settings
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-[1.7] text-foreground/65">
              Tune how client priority scores weigh each parameter (F096).
              Saving recalculates every existing client&apos;s score and records
              the change in the audit log.
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm font-bold">
            <Link className="text-brand hover:underline" href="/admin">
              ← Platform management
            </Link>
          </div>
        </Rise>

        {error && (
          <Rise>
            <p
              className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive"
              role="alert"
            >
              The stored configuration could not be loaded. The values shown are
              defaults — do not treat them as the live weights until this is fixed.
            </p>
          </Rise>
        )}

        <ScoreSettingsPanel
          activeVersion={data?.version ?? null}
          activeWeights={activeWeights}
          degraded={degraded}
        />
      </Stage>
    </div>
  );
}
