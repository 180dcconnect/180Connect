import { z } from "zod";

/**
 * F119: the payload for saveEmailDraft. Deliberately looser than
 * reviewedEmailSchema (send-reviewed.ts) — saving a work-in-progress draft
 * has none of sending's requirements: no recipient, no explicit approval, and
 * an empty subject or body is a valid thing to save and come back to later.
 * Lives outside the "use server" file for the same reason send-reviewed.ts
 * does — unit-testable without a Next.js runtime.
 */
export const saveDraftSchema = z.object({
  organisationId: z.uuid(),
  messageId: z.uuid(),
  subject: z.string().trim().max(998, "Must be 998 characters or fewer."),
  body: z.string().max(200_000, "Must be 200000 characters or fewer."),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
