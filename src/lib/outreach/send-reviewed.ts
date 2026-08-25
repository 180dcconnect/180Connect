import { z } from "zod";
import { emailField, nonEmptyTrimmed } from "../validation.ts";

/**
 * F123: the payload for sendReviewedEmail. Lives outside the "use server" file so
 * its rejection rules (missing approval, blank subject/body) are unit-testable
 * without a Next.js runtime — the no-approval path is one of issue #120's named
 * testing cases.
 */
export const reviewedEmailSchema = z.object({
  organisationId: z.uuid(),
  messageId: z.uuid(),
  // F116: the CAM-reviewed recipient, not a value re-derived from the
  // organisation/contact record — same "reviewed content is what sends" rule
  // subject and body already follow.
  recipient: emailField("Add a valid recipient email address before sending."),
  subject: nonEmptyTrimmed(998, "Add a subject before sending."),
  body: nonEmptyTrimmed(100_000, "Add email content before sending."),
  explicitlyApproved: z.literal(true, {
    error: "Review the email and confirm approval before sending.",
  }),
});

export type ReviewedEmailInput = z.infer<typeof reviewedEmailSchema>;
