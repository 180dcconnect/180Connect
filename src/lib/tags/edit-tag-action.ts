"use server";

// Server action wrapper for F189 (Edit Tag). The pure logic lives in
// edit-tag.ts / edit-tag-core.ts — this exists only to expose it as a
// callable server action for the edit UI.

import { editTag } from "./edit-tag.ts";
import type { EditTagResult } from "./edit-tag-core.ts";

export async function editTagAction(
  tagId: string,
  newName: string,
): Promise<EditTagResult> {
  return editTag(tagId, newName);
}
