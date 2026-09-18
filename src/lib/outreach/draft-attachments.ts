import { z } from "zod";

/**
 * F217: the payload for attachDraftFile/detachDraftFile. Lives outside the
 * "use server" file for the same reason discard-draft.ts does — unit-testable
 * without a Next.js runtime.
 */
export const draftAttachmentSchema = z.object({
  organisationId: z.uuid(),
  messageId: z.uuid(),
  attachmentId: z.uuid(),
});

export type DraftAttachmentInput = z.infer<typeof draftAttachmentSchema>;
