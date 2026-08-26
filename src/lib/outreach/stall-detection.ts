/**
 * F183 (#179) — Stall Detection. Which clients across the whole team have
 * gone silent past the point where a follow-up is already URGENT and nobody
 * has anything planned for them.
 *
 * Pure core, same shape as follow-up-recommendations.ts (F160): no database —
 * the admin Team Pipeline View assembles inputs and renders the flags, and the
 * daily cron sweep calls this with the same inputs to record an audit entry.
 *
 * THE RULES:
 * - A client is stalled when it sits in one of F160's trigger statuses, its
 *   silence has crossed its OWNER'S second follow-up threshold (the "urgent"
 *   boundary — defaults 7/14 days per outreach_preferences), and it has NO
 *   open action. An open action means someone has taken charge; a completed
   * one does not suppress the flag, because the work is done and the client
 *   may still be waiting.
 * - Thresholds are looked up per owner so each CAM's own settings govern their
 *   clients; owners without a preferences row (and unowned clients) fall back
 *   to DEFAULT_FOLLOW_UP_THRESHOLDS.
 * - The activity clock is F160's unchanged: latest of last sent email, last
 *   received reply, last audited status change. Notes are deliberately not a
 *   clock source — that was agreed for F160 on 26 Aug 2026 and reusing it here
 *   keeps one definition of silence across the app.
 */
import { DEFAULT_FOLLOW_UP_THRESHOLDS } from "./follow-up-recommendations.ts";
import {
  FOLLOW_UP_TRIGGER_STATUSES,
  lastActivityAt,
  normaliseThresholds,
  type ClientActivity,
  type FollowUpCandidate,
  type FollowUpThresholds,
} from "./follow-up-recommendations.ts";

export type StallCandidate = FollowUpCandidate & {
  owner_id: string | null;
};

export type StallFlag = {
  organisationId: string;
  ownerId: string | null;
  /** Whole days of silence, floored — measured from the client's last activity. */
  daysWaiting: number;
};

/**
 * The stall flags themselves: candidates in a trigger status whose silence
 * crossed their owner's urgent boundary and who have nothing open, sorted
 * longest-silence first — the top of the list is the most neglected client.
 */
export function stalledClients(
  candidates: readonly StallCandidate[],
  activityByOrganisation: ReadonlyMap<string, ClientActivity>,
  thresholdsByOwner: ReadonlyMap<string, FollowUpThresholds>,
  orgIdsWithOpenActions: ReadonlySet<string>,
  now: Date = new Date(),
): StallFlag[] {
  const nowMs = now.getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const flags: StallFlag[] = [];
  for (const candidate of candidates) {
    if (!FOLLOW_UP_TRIGGER_STATUSES.has(candidate.outreach_status)) continue;
    if (orgIdsWithOpenActions.has(candidate.id)) continue;

    const activity = activityByOrganisation.get(candidate.id);
    const lastActivity = activity ? lastActivityAt(activity) : null;
    if (!lastActivity) continue;

    const thresholds = normaliseThresholds(
      thresholdsByOwner.get(candidate.owner_id ?? "") ?? DEFAULT_FOLLOW_UP_THRESHOLDS,
    );
    const daysWaiting = Math.floor((nowMs - Date.parse(lastActivity)) / DAY_MS);
    if (daysWaiting < thresholds.second) continue;

    flags.push({
      organisationId: candidate.id,
      ownerId: candidate.owner_id,
      daysWaiting,
    });
  }

  return flags.sort((a, b) => {
    if (a.daysWaiting !== b.daysWaiting) return b.daysWaiting - a.daysWaiting;
    return a.organisationId.localeCompare(b.organisationId);
  });
}
