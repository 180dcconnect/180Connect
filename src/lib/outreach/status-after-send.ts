/**
 * F147 — which pipeline status a send leaves the client on. Extracted from
 * sendReviewedEmail (outreach-actions.ts) so the decision can be pinned by
 * plain unit tests without a database or the Gmail transport.
 *
 * AC1/AC2: the very first email moves a client out of not_contacted into
 * initial_outreach_sent; any later send — whatever the client currently reads
 * (a re-send, an extra follow-up, even after a manual detour elsewhere) —
 * reads follow_up_sent, never "initial". The distinction between exactly one
 * sent email and more than one therefore lives in this one branch, and
 * initial_outreach_sent is unreachable by sending twice.
 */
import type { PipelineStatus } from "../organisation-format.ts";

export function nextStatusAfterSend(currentStatus: string): PipelineStatus {
  return currentStatus === "not_contacted" ? "initial_outreach_sent" : "follow_up_sent";
}

/**
 * The caller's fallback when the client's current status cannot be read at
 * send time (transient select failure after the email is already out).
 * follow_up_sent is the conservative under-label: it self-heals on the next
 * send, whereas defaulting to not_contacted would mislabel a repeat send as
 * the first one and write a false audit row.
 */
export const UNREADABLE_STATUS_FALLBACK: PipelineStatus = "follow_up_sent";
