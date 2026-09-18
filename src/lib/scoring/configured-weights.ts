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
import {
  DEFAULT_SCORING_RULES,
  sanitizeScoringRules,
  type ScoringRules,
} from "./scout-config.ts";

export type ActiveScoutConfig = {
  weights: ScoutWeights;
  version: string | null;
  /** F097: the active MODEL_VERSIONS row's id — what a score snapshot cites. */
  id: string | null;
  /** True when the database could not be read/parsed and defaults were used. */
  degraded: boolean;
  /**
   * What each check rewards — sector ranking, priority towns, band scores — from
   * the same config row. Optional in the type so hand-built test configs stay
   * valid; every config this module returns carries it.
   */
  rules?: ScoringRules;
  /** When the active version was saved; scores older than this predate it. */
  createdAt?: string | null;
};

type ModelVersionRow = {
  id: string;
  version: string;
  config: { weights?: unknown } | null;
  created_at: string;
};

export async function getActiveScoutConfig(): Promise<ActiveScoutConfig> {
  const admin = createAdminClient();
  if (!admin) {
    await reportError(new Error("Service-role client unavailable for SCOUT config"), {
      operation: "scout_config.load",
    });
    return {
      weights: DEFAULT_WEIGHTS,
      version: null,
      id: null,
      degraded: true,
      rules: DEFAULT_SCORING_RULES,
      createdAt: null,
    };
  }

  const { data, error } = await admin
    .from("model_versions")
    .select("id, version, config, created_at")
    .eq("model_name", "SCOUT")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<ModelVersionRow>();

  if (error || !data) {
    await reportError(
      error ?? new Error("No active SCOUT model version row found"),
      { operation: "scout_config.load" },
    );
    return {
      weights: DEFAULT_WEIGHTS,
      version: data?.version ?? null,
      id: data?.id ?? null,
      degraded: true,
      rules: DEFAULT_SCORING_RULES,
      createdAt: null,
    };
  }

  // v1 predates the partnership-history parameter (four-key config); sanitize
  // per-key so the missing fifth key degrades to its default instead of
  // rejecting the whole config.
  return {
    weights: sanitizeWeights(data.config?.weights),
    version: data.version,
    id: data.id,
    degraded: false,
    rules: sanitizeScoringRules(data.config),
    createdAt: data.created_at,
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
