"use server";

// Server action wrapper for F190 (Delete Tag). The pure logic lives in
// delete-tag.ts / delete-tag-core.ts — this exists only to expose it as a
// callable server action, since the delete UI needs something invocable
// from the browser without a full page reload.

import { revalidatePath } from "next/cache";
import { deleteTag } from "./delete-tag.ts";
import type { DeleteTagResult } from "./delete-tag-core.ts";

export async function deleteTagAction(tagId: string): Promise<DeleteTagResult> {
  const result = await deleteTag(tagId);
  if (result.ok) {
    // A deleted tag must not linger in cached views: it shows on the
    // client list/profile chips and in tag filter UIs (F191/F193 query the
    // tags table directly), so Next's client Router Cache needs invalidating
    // — same paths as set-tag-colour-action, which has the same exposure.
    revalidatePath("/admin/tags");
    revalidatePath("/clients", "layout");
  }
  return result;
}
