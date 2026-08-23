"use server";

// Server action wrapper for F191 (Assign Tag to Client). The pure logic
// lives in assign-tag.ts / assign-tag-core.ts — this exists only to
// expose it as a callable server action for the assign UI.

import { assignTags } from "./assign-tag.ts";
import type { AssignTagsOutcome } from "./assign-tag.ts";

export async function assignTagAction(
  organisationId: string,
  tagId: string,
): Promise<AssignTagsOutcome> {
  return assignTags(organisationId, [tagId]);
}
