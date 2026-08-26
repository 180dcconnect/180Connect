export type OutreachStage = "stage_one" | "stage_two" | "scheduled" | "recurring";

/** The one refusal message, exported so callers that pre-check can reuse it verbatim. */
export const HUMAN_REVIEW_REQUIRED_MESSAGE = "Review the email and confirm approval before sending.";

/** One non-negotiable rule shared by every outreach stage (F121/F250). */
export function humanReviewDecision(stage: OutreachStage, explicitlyApproved: boolean): { allowed: true; stage: OutreachStage } | { allowed: false; message: string } {
  if (!explicitlyApproved) return { allowed: false, message: HUMAN_REVIEW_REQUIRED_MESSAGE };
  return { allowed: true, stage };
}
