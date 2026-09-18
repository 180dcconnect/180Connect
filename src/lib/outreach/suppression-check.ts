/** F249 provider-neutral point-of-send suppression gate. */
export type ActiveSuppression = { id: string; reason: string };

export type SuppressionCheckResult =
  | { allowed: true }
  | { allowed: false; kind: "suppressed"; suppressionId: string; reason: string }
  | { allowed: false; kind: "unavailable" };

export type FindActiveSuppression = (
  organisationId: string,
) => Promise<ActiveSuppression | null>;

/**
 * The lookup must read current state at action time. Cached draft/page state is never
 * accepted because an organisation can be suppressed after the draft was opened.
 */
export async function checkSuppressionBeforeSend(
  organisationId: string,
  findActiveSuppression: FindActiveSuppression,
): Promise<SuppressionCheckResult> {
  try {
    const suppression = await findActiveSuppression(organisationId);
    if (!suppression) return { allowed: true };
    return {
      allowed: false,
      kind: "suppressed",
      suppressionId: suppression.id,
      reason: suppression.reason.trim() || "No reason was recorded.",
    };
  } catch {
    // Compliance checks fail closed: lookup failure is never permission to send.
    return { allowed: false, kind: "unavailable" };
  }
}

export function suppressionBlockedMessage(reason: string): string {
  return `This client is suppressed. Outreach is blocked. Reason: ${reason}`;
}
