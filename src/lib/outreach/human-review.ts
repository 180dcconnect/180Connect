export type OutreachStage = "stage_one" | "stage_two" | "scheduled" | "recurring";

/** One non-negotiable rule shared by every outreach stage (F121/F250). */
export function humanReviewDecision(stage: OutreachStage, explicitlyApproved: boolean): { allowed: true; stage: OutreachStage } | { allowed: false; message: string } {
  if (!explicitlyApproved) return { allowed: false, message: "Review the email and confirm approval before sending." };
  return { allowed: true, stage };
}
