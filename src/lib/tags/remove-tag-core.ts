// F192: Remove Tag from Client — pure decision logic.
//
// Same reasoning as create-tag-core.ts and assign-tag-core.ts: no import of
// anything that pulls in "server-only", so this is directly unit-testable
// without a real Next.js request context.
//
// AC1: removing a tag from one client never touches another client's
// assignment of the same tag — guaranteed structurally, since the delete is
// scoped by (organisation_id, tag_id) together, not tag_id alone.
// AC3: removing the last assignment of a tag never deletes the tag itself
// — this function only ever touches org_tags, never tags. Deleting a tag
// entirely is F190's job, a different table, not reachable from here.
//
// Removing an assignment that doesn't exist (already removed, or never
// existed) is treated as a successful no-op, not an error — a DELETE that
// matches zero rows isn't a failure in Postgres, and re-clicking "remove"
// after it already succeeded shouldn't surface an error to the CAM.

export type RemoveTagResult =
  | { ok: true }
  | { ok: false; message: string };

export interface OrgTagDeleteClient {
  deleteOrgTag(
    organisationId: string,
    tagId: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
}

/**
 * Shared "tags:manage" permission — see create-tag-core.ts for why tags do
 * not borrow "client:edit".
 */
export const REMOVE_TAG_PERMISSION = "tags:manage" as const;

export async function removeTagCore(
  organisationId: string,
  tagId: string,
  client: OrgTagDeleteClient,
): Promise<RemoveTagResult> {
  const outcome = await client.deleteOrgTag(organisationId, tagId);

  if (!outcome.ok) {
    return {
      ok: false,
      message: "This tag could not be removed. Please try again later.",
    };
  }

  return { ok: true };
}
