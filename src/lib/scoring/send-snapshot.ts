// F097: the feature half of the ML training set, captured at send time.
//
// SCORE_SNAPSHOTS stores what was true about a client's scoring inputs at the
// moment an outreach email went out (migration 20260911120000). LATEST_SCORES
// cannot answer that question once inputs move; this module is the only
// builder of those rows.
//
// Split in two for testability:
//   assembleScoreSnapshot  pure — org data + active config → jsonb payload
//   buildScoreSnapshot     server-only — loads both from the database and logs
//                          instead of throwing (best-effort, same contract as
//                          rescore.ts: a failed snapshot must never fail the
//                          send it rides on)
//
// TIMING CONTRACT: callers build this BEFORE recording the send. The RPCs
// insert it inside their own transaction, but the factors must be read from
// pre-send state — previousContact especially, which scores the status the
// client was on when the outreach happened.

import { calculatePriorityScore } from "./calculate-priority-score.ts";
import {
  priorityFactorsFor,
  bandForScore,
  type ScoreableOrganisation,
} from "./score-client.ts";
import type { ActiveScoutConfig } from "./configured-weights.ts";

/** The jsonb shape insert_score_snapshot validates against. */
export type ScoreSnapshotPayload = {
  sector: number;
  geography: number;
  size: number;
  partnership_history: number;
  previous_contact: number;
  priority_score: number;
  priority_band: "high" | "medium" | "low";
  model_version_id: string | null;
};

/**
 * Pure assembly: the five normalised factors under the active SCOUT weights,
 * plus the score/band they produce and the generation that produced them.
 * Never throws — missing inputs degrade inside priorityFactorsFor exactly as
 * they do for the live score, so a sparse client still yields an honest row.
 */
export function assembleScoreSnapshot(
  org: ScoreableOrganisation,
  config: ActiveScoutConfig,
): ScoreSnapshotPayload {
  const factors = priorityFactorsFor(org);
  const score = calculatePriorityScore(factors, config.weights);
  return {
    sector: factors.sector,
    geography: factors.geography,
    size: factors.size,
    partnership_history: factors.partnershipHistory,
    previous_contact: factors.previousContact,
    priority_score: score,
    priority_band: bandForScore(score),
    model_version_id: config.degraded ? null : config.id,
  };
}
