"use server";

// Server action wrapper for F192 (Remove Tag from Client). The pure logic
// lives in remove-tag.ts / remove-tag-core.ts — this file exists only to
// expose it as a callable server action ("use server") and to invalidate
// the server-rendered caches that display tags, so other screens never
// show a stale assignment after a removal.

import { revalidatePath } from "next/cache";

import { removeTag } from "./remove-tag.ts";
import type { RemoveTagResult } from "./remove-tag-core.ts";

export async function removeTagAction(
  organisationId: string,
  tagId: string,
): Promise<RemoveTagResult> {
  const result = await removeTag(organisationId, tagId);

  if (result.ok) {
    // The client profile shows the chips; the client list is where any
    // tag-based filtering will live once F193's filter is reintegrated.
    // The optimistic local update keeps AC2's no-reload feel; these calls
    // only mark server caches stale for the next navigation.
    revalidatePath(`/clients/${organisationId}`);
    revalidatePath("/clients");
  }

  return result;
}
