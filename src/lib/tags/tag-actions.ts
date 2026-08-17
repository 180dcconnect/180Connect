"use server";

// Server action wrapper for F192 (Remove Tag from Client). The pure logic
// lives in remove-tag.ts / remove-tag-core.ts — this file exists only to
// expose it as a callable server action ("use server"), since a client
// component (TagChips.tsx) needs something invocable from the browser
// without a full page reload (F192 AC2).

import { removeTag } from "./remove-tag.ts";
import type { RemoveTagResult } from "./remove-tag-core.ts";

export async function removeTagAction(
  organisationId: string,
  tagId: string,
): Promise<RemoveTagResult> {
  return removeTag(organisationId, tagId);
}