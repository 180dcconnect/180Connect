import { z } from "zod";
import { emailField, nonEmptyTrimmed } from "../validation.ts";
import { emailHtmlToPlainText } from "./email-html.ts";

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
  // F117: body is HTML from the rich-text editor. A trimmed, non-empty string
  // is not enough on its own — an editor left as "<p></p>" is non-empty text
  // with no real content, so this also requires actual text once the markup
  // is stripped. `emailHtmlToPlainText` is the same function that derives the
  // plain-text MIME part, so "has content" and "what the plain part contains"
  // can never disagree.
  body: z
    .string()
    .max(200_000, "Must be 200000 characters or fewer.")
    .refine((html) => emailHtmlToPlainText(html).length > 0, "Add email content before sending."),
  // F121 + review defence-in-depth: approval must be literally true at the
  // schema boundary — validation refuses unapproved payloads outright, so
  // safety does not depend on a future caller remembering the checkpoint.
  // @/lib/outreach/human-review remains the single source of the refusal
  // message and the rule every stage (including ones without a schema yet)
  // must pass.
  explicitlyApproved: z.literal(true, {
    error: "Review the email and confirm approval before sending.",
  }),
});

export type ReviewedEmailInput = z.infer<typeof reviewedEmailSchema>;
