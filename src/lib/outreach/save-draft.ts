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
  // F119 AC1: the recipient is part of the draft's saved state. Unlike sending
  // (send-reviewed.ts) a work-in-progress address is not validated here — half
  // typed is exactly what a save mid-edit looks like. Empty/absent means "no
  // reviewed recipient yet" and persists as null.
  recipient: z.string().max(320, "Must be 320 characters or fewer.").optional(),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
