import { formatOutreachStatus } from "./organisation-format.ts";
import { formatRelativeTime, humaniseToken } from "./display-format.ts";

export type RawTeamActivityRow = {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  target_name: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type FormattedTeamActivity = {
  id: string;
  actorName: string;
  actionLabel: string;
  sentence: string;
  targetName: string | null;
  targetHref: string | null;
  relativeTime: string;
  createdAt: string;
};

/**
 * F029 — Formats raw team audit events into clean, user-facing sentences
 * attributed to the specific user who took the action (AC1/AC2).
 *
 * Example formats:
 * - "5 clients added by Mohammed Saeed"
 * - "Mohammed Saeed claimed ownership of Oxford Homeless Project"
 * - "Sarah Jenkins moved Amnesty International to Initial outreach sent"
 */
export function formatTeamActivity(
  row: RawTeamActivityRow,
  now: Date = new Date(),
): FormattedTeamActivity {
  const actorName = row.actor_name?.trim() || "A team member";
  const target = row.target_name?.trim() || "a client";
  const detail = row.detail ?? {};
  const when = new Date(row.created_at);

  let sentence: string;
  let actionLabel = "Team";

  // Check for batch client addition (AC1 example format: "5 clients added by X")
  if (
    row.action === "client_added" ||
    row.action === "clients_imported" ||
    (typeof detail.count === "number" && detail.count > 1)
  ) {
    const count = typeof detail.count === "number" ? detail.count : 1;
    sentence = `${count} client${count === 1 ? "" : "s"} added by ${actorName}`;
    actionLabel = "Import";
  } else {
    switch (row.action) {
      case "ownership_assigned":
      case "ownership_reassigned":
        actionLabel = "Ownership";
        // claim_organisation (F162) and reassign_ownership (F257/F164) both write
        // 'ownership_reassigned'; only `detail.trigger` tells them apart, and a
        // self-claim reads as a claim, not as an admin moving someone's client.
        if (detail.trigger === "self_claim" || detail.self_claim === true) {
          sentence = `${actorName} claimed ownership of ${target}`;
        } else if (row.action === "ownership_reassigned") {
          sentence = `${actorName} reassigned ownership of ${target}`;
        } else {
          sentence = `${actorName} assigned ownership of ${target}`;
        }
        break;

      case "status_changed":
        actionLabel = "Pipeline";
        if (typeof detail.to === "string") {
          sentence = `${actorName} moved ${target} to ${formatOutreachStatus(detail.to)}`;
        } else {
          sentence = `${actorName} updated status of ${target}`;
        }
        break;

      case "suppression_requested":
        actionLabel = "Suppression";
        sentence = `${actorName} requested suppression of ${target}`;
        break;

      case "suppression_approved":
        actionLabel = "Suppression";
        sentence = `${actorName} approved suppression of ${target}`;
        break;

      case "invite_accepted":
        actionLabel = "Team";
        sentence = `${actorName} joined the team`;
        break;

      case "organisation_status_flagged":
        actionLabel = "Flag";
        sentence = `${actorName} flagged ${target}`;
        break;

      case "organisation_status_flag_acknowledged":
        actionLabel = "Flag";
        sentence = `${actorName} acknowledged a flag on ${target}`;
        break;

      case "data_quality_event_resolved":
        actionLabel = "Quality";
        sentence = `${actorName} resolved a data issue on ${target}`;
        break;

      case "duplicate_confirmed":
        actionLabel = "Duplicate";
        sentence = `${actorName} confirmed a duplicate match for ${target}`;
        break;

      case "duplicate_dismissed":
        actionLabel = "Duplicate";
        sentence = `${actorName} dismissed a duplicate match for ${target}`;
        break;

      default:
        actionLabel = humaniseToken(row.action);
        sentence = `${actorName} updated ${target}`;
        break;
    }
  }

  const targetHref =
    row.target_table === "organisations" && row.target_id
      ? `/clients/${row.target_id}`
      : null;

  return {
    id: row.id,
    actorName,
    actionLabel,
    sentence,
    targetName: row.target_name,
    targetHref,
    relativeTime: formatRelativeTime(when, now),
    createdAt: row.created_at,
  };
}

/**
 * Transforms an array of raw activity rows into formatted entries.
 * Filters out actions performed by the current actor when `excludeActorId` is given,
 * ensuring CAMs see actions by other team members (F029 user story).
 */
export function formatTeamActivities(
  rows: RawTeamActivityRow[],
  excludeActorId?: string | null,
  now: Date = new Date(),
): FormattedTeamActivity[] {
  const filtered = excludeActorId
    ? rows.filter((row) => row.actor_user_id !== excludeActorId)
    : rows;

  return filtered.map((row) => formatTeamActivity(row, now));
}
