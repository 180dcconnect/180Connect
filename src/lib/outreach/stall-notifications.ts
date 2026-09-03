/**
 * F184 (#180) — Whole-Team Stall Notification.
 *
 * Pure formatting, recipient resolution, and transition detection logic for
 * alerting when a client becomes stalled in the CRM pipeline.
 *
 * THE RULES:
 * - Who receives alerts:
 *   Alerts go to all active Admins, plus the owning CAM (if assigned).
 *   Any CAM who does not own the client must NOT receive the alert.
 *   If the client is unowned, only Admins receive the alert.
 *   If an Admin happens to be the owner, their ID is deduplicated.
 * - Cadence:
 *   Notifications are triggered only when a client newly transitions into
 *   stalled status (i.e. was not in the previous sweep's stalled set).
 *   This avoids daily alert spam for continuing stalls.
 * - Notification Content:
 *   Identifies the specific client by legal name and how many days it has
 *   been inactive with no open action.
 *   Links directly to the client profile at `/clients/${organisationId}`.
 */

import type { StallFlag } from "./stall-detection.ts";

export const STALL_NOTIFICATION_TYPE = "client_stalled" as const;

export type StallNotificationPayload = {
  notificationType: typeof STALL_NOTIFICATION_TYPE;
  title: string;
  body: string;
  linkPath: string;
  targetTable: "organisations";
  targetId: string;
};

/**
 * Builds the notification payload for a stalled organisation.
 * AC3: Identifies which client is stalled and how long it's been inactive.
 */
export function buildStallNotificationPayload(
  candidate: { id: string; legal_name: string },
  daysWaiting: number,
): StallNotificationPayload {
  const daysText = daysWaiting === 1 ? "1 day" : `${daysWaiting} days`;
  return {
    notificationType: STALL_NOTIFICATION_TYPE,
    title: `${candidate.legal_name} is stalled`,
    body: `Inactive for ${daysText} with no open action. Follow-up is overdue.`,
    linkPath: `/clients/${candidate.id}`,
    targetTable: "organisations",
    targetId: candidate.id,
  };
}

/**
 * Resolves the recipient user IDs for a stalled client alert.
 *
 * F184 AC2 / Team Decision:
 * - All active admins receive the alert (prevents CAM going MIA without oversight).
 * - The owning CAM receives the alert (if assigned).
 * - Non-owning CAMs do NOT receive the alert.
 * - Recipient IDs are deduplicated (e.g. if the owner is also an admin).
 */
export function resolveStallNotificationRecipients(
  ownerId: string | null,
  adminUserIds: readonly string[],
): string[] {
  const recipients = new Set<string>();

  for (const adminId of adminUserIds) {
    if (adminId && adminId.trim() !== "") {
      recipients.add(adminId.trim());
    }
  }

  if (ownerId && ownerId.trim() !== "") {
    recipients.add(ownerId.trim());
  }

  return Array.from(recipients);
}

/**
 * Identifies which stalled clients are newly stalled relative to the
 * previous sweep, so notifications are only sent on the initial stall transition.
 */
export function findNewlyStalledClients(
  currentFlags: readonly StallFlag[],
  previousStalledIds: ReadonlySet<string>,
): StallFlag[] {
  return currentFlags.filter((flag) => !previousStalledIds.has(flag.organisationId));
}
