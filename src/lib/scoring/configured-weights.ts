// F096: reads the weights the active SCOUT model version was configured with.
//
// MODEL_VERSIONS.config is the single record of what produced every stored
// score (migration 20260831200000 — "history, not an edit"), so the rescore
// paths must score under the *active* config, not a hard-coded table. This is
// the one place that translation lives.
//
// Reading needs the service role: model_versions grants authenticated SELECT to
// admins only (the weights are deliberately CAM-hidden), while rescoring is
// triggered from contexts that hold an admin session but run server-side.
//
// Failure policy mirrors rescore.ts's best-effort contract: if the config can't
// be read or parsed, fall back to DEFAULT_WEIGHTS and log loudly rather than
// failing the save the rescore is attached to. A stale-by-one-generation score
// is recoverable (re-run the sweep); a crashed write path is not.

import "server-only";

// Relative imports: this module sits on the import chain of
// write-organisations.test.ts, which runs under `node --test` and cannot
// resolve Next's tsconfig path aliases.
import { createAdminClient } from "../supabase/admin.ts";
import { reportError } from "../error-logging.ts";
import { sanitizeWeights, DEFAULT_WEIGHTS, type ScoutWeights } from "./calculate-priority-score.ts";

export type ActiveScoutConfig = {
  weights: ScoutWeights;
  version: string | null;
  /** True when the database could not be read/parsed and defaults were used. */
  degraded: boolean;
};

type ModelVersionRow = {
  version: string;
  config: { weights?: unknown } | null;
};

export async function getActiveScoutConfig(): Promise<ActiveScoutConfig> {
  const admin = createAdminClient();
  if (!admin) {
    await reportError(new Error("Service-role client unavailable for SCOUT config"), {
      operation: "scout_config.load",
    });
    return { weights: DEFAULT_WEIGHTS, version: null, degraded: true };
  }

  const { data, error } = await admin
    .from("model_versions")
    .select("version, config")
    .eq("model_name", "SCOUT")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<ModelVersionRow>();

  if (error || !data) {
    await reportError(
      error ?? new Error("No active SCOUT model version row found"),
      { operation: "scout_config.load" },
    );
    return { weights: DEFAULT_WEIGHTS, version: data?.version ?? null, degraded: true };
  }

  // v1 predates the partnership-history parameter (four-key config); sanitize
  // per-key so the missing fifth key degrades to its default instead of
  // rejecting the whole config.
  return {
    weights: sanitizeWeights(data.config?.weights),
    version: data.version,
    degraded: false,
  };
}

/**
 * Convenience wrapper for call sites that only need the numbers. Kept separate
 * so callers that want to show which generation produced a score (the settings
 * screen does) can use getActiveScoutConfig directly.
 */
export async function getActiveScoutWeights(): Promise<ScoutWeights> {
  return (await getActiveScoutConfig()).weights;
}
