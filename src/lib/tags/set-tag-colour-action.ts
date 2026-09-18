"use server";

// Server action wrapper for F194 (Set Tag Colour). The pure logic lives in
// set-tag-colour.ts / set-tag-colour-core.ts — this exists only to expose it
// as a callable server action for the colour UI.

import { revalidatePath } from "next/cache";
import { setTagColour } from "./set-tag-colour.ts";
import type { SetTagColourResult } from "./set-tag-colour-core.ts";

export async function setTagColourAction(
  tagId: string,
  rawColour: unknown,
): Promise<SetTagColourResult> {
  const result = await setTagColour(tagId, rawColour);
  if (result.ok) {
    // The colour shows on the client profile's chips too.
    revalidatePath("/admin/tags");
    revalidatePath("/clients", "layout");
  }
  return result;
}
