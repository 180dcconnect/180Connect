import { z } from "zod";

/**
 * F120: the payload for discardEmailDraft. No content fields — discarding
 * only ever needs to know which draft, on which organisation, to remove.
 * Lives outside the "use server" file for the same reason save-draft.ts does
 * — unit-testable without a Next.js runtime.
 */
export const discardDraftSchema = z.object({
  organisationId: z.uuid(),
  messageId: z.uuid(),
});

export type DiscardDraftInput = z.infer<typeof discardDraftSchema>;
