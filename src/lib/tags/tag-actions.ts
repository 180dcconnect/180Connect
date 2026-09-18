"use server";

// Server action wrapper for F192 (Remove Tag from Client). The pure logic
// lives in remove-tag.ts / remove-tag-core.ts — this file exists only to
// expose it as a callable server action ("use server") and to invalidate
// the server-rendered caches that display tags, so other screens never
// show a stale assignment after a removal.

import { revalidatePath } from "next/cache";

import { removeTag } from "./remove-tag.ts";
import { createTag } from "./create-tag.ts";
import { assignTags } from "./assign-tag.ts";
import type { RemoveTagResult } from "./remove-tag-core.ts";
import type { CreateTagResult } from "./create-tag-core.ts";

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

export async function createTagAction(
  name: string,
  colour?: string | null,
): Promise<CreateTagResult> {
  const result = await createTag(name, colour);
  if (result.ok) {
    revalidatePath("/admin/tags");
  }
  return result;
}

export async function assignTagsBatchAction(
  organisationId: string,
  tagIds: string[],
) {
  const result = await assignTags(organisationId, tagIds);
  if (result.ok) {
    revalidatePath(`/clients/${organisationId}`);
    revalidatePath("/clients");
  }
  return result;
}

export async function createAndAssignTagAction(
  organisationId: string,
  name: string,
  colour?: string | null,
) {
  const createRes = await createTag(name, colour);
  if (!createRes.ok) return createRes;
  const assignRes = await assignTags(organisationId, [createRes.tag.id]);
  if (!assignRes.ok) return { ok: false as const, message: assignRes.message };
  revalidatePath(`/clients/${organisationId}`);
  revalidatePath("/clients");
  revalidatePath("/admin/tags");
  return { ok: true as const, tag: createRes.tag };
}
