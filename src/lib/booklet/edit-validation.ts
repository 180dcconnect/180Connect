/**
 * Manual booklet editing — the input rules, kept pure and node-testable.
 *
 * An edit is validated twice: here (shape, blankness, length, and "did
 * anything actually change") and in the Server Action (permission, and that
 * the edited version is still the latest — see booklet-actions.ts). This file
 * owns the half that needs no database.
 */

import { z } from "zod";
import { nonEmptyTrimmed, safeValidate } from "../validation.ts";

/**
 * Well above any real booklet — generations run to a few thousand characters,
 * and email prompts cap what they read at 6,000 (MAX_BOOKLET_CHARS) — while
 * still bounding what one save can store. Prompts keep capping at read time,
 * so length here is a storage guard, not a content rule.
 */
export const MAX_BOOKLET_EDIT_CHARS = 20_000;

const EditInputSchema = z.object({
  organisationId: z.uuid(),
  baseVersionId: z.uuid(),
  text: nonEmptyTrimmed(MAX_BOOKLET_EDIT_CHARS, "Write something first — an empty booklet cannot be saved."),
});

export type BookletEditInput = {
  organisationId: string;
  baseVersionId: string;
  /** Trimmed by the schema. */
  text: string;
};

/**
 * Coerces anything the client sent into a trusted edit, or one plain-English
 * sentence saying why not. Never throws: a bad shape is a message, not a 500.
 */
export function parseBookletEditInput(
  input: unknown,
): { ok: true; data: BookletEditInput } | { ok: false; message: string } {
  const parsed = safeValidate(EditInputSchema, input);
  if (!parsed.success) {
    const first = Object.values(parsed.fieldErrors).flat().find(Boolean);
    return {
      ok: false,
      message: typeof first === "string" ? first : "That edit could not be read. Try again.",
    };
  }
  return { ok: true, data: parsed.data };
}

/** Whether the edited text actually says something different from the base version. */
export function editDiffers(baseText: string, editedText: string): boolean {
  return baseText.trim() !== editedText.trim();
}
