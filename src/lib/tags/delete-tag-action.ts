"use server";

// Server action wrapper for F190 (Delete Tag). The pure logic lives in
// delete-tag.ts / delete-tag-core.ts — this exists only to expose it as a
// callable server action, since the delete UI needs something invocable
// from the browser without a full page reload.

import { deleteTag } from "./delete-tag.ts";
import type { DeleteTagResult } from "./delete-tag-core.ts";

export async function deleteTagAction(tagId: string): Promise<DeleteTagResult> {
  return deleteTag(tagId);
}
