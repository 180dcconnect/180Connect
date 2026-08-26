// F191: Assign Tag to Client — pure decision logic.
//
// Same reasoning as create-tag-core.ts: no import of anything that pulls in
// "server-only", so this is directly unit-testable without a real Next.js
// request context.
//
// AC1: a CAM can assign one OR MORE tags in one action — assignTagsCore
// takes an array, not a single tag id.
// AC2: assigning a tag the client already has is a no-op, not an error —
// distinct from F188's behaviour, where a duplicate *tag name* is rejected
// with a message. Here, a duplicate *assignment* (org_tags_unique_assignment,
// Postgres code 23505) is swallowed silently and counted as already-assigned,
// not surfaced as a failure to the CAM.
// AC3 ("appears immediately across client profile and list view") is a UI/
// data-freshness concern for whichever screens read org_tags, not something
// this function itself can guarantee — flagged, not solved here.

export type AssignTagsResult = {
  assigned: string[]; // tag ids newly assigned this call
  alreadyAssigned: string[]; // tag ids that were no-ops (AC2)
  failed: { tagId: string; message: string }[]; // genuine failures, e.g. an
  // invalid/nonexistent tag id — testing notes call for this explicitly.
};

export interface OrgTagInsertClient {
  insertOrgTag(
    organisationId: string,
    tagId: string,
    addedByUserId: string,
  ): Promise<
    | { ok: true }
    | { ok: false; code: string | null; message: string }
  >;
}

/**
 * Shared "tags:manage" permission — see create-tag-core.ts for why tags do
 * not borrow "client:edit".
 */
export const ASSIGN_TAG_PERMISSION = "tags:manage" as const;

export async function assignTagsCore(
  organisationId: string,
  tagIds: string[],
  actorId: string,
  client: OrgTagInsertClient,
): Promise<AssignTagsResult> {
  const result: AssignTagsResult = {
    assigned: [],
    alreadyAssigned: [],
    failed: [],
  };

  // Dedup the input itself — assigning the same tag id twice in one call
  // should behave the same as assigning it in two separate calls (AC2).
  const uniqueTagIds = Array.from(new Set(tagIds));

  for (const tagId of uniqueTagIds) {
    const outcome = await client.insertOrgTag(organisationId, tagId, actorId);

    if (outcome.ok) {
      result.assigned.push(tagId);
      continue;
    }

    if (outcome.code === "23505") {
      // AC2: already assigned — a no-op, not a failure.
      result.alreadyAssigned.push(tagId);
      continue;
    }

    // A genuine failure. The raw DB message (outcome.message) is never
    // surfaced here — that's server-side detail, already sent to
    // reportError by the real entry point (assign-tag.ts). Only a safe,
    // specific-where-possible message goes into the result CAMs will see.
    result.failed.push({
      tagId,
      message:
        outcome.code === "23503"
          ? "This tag no longer exists."
          : "This tag could not be assigned. Please try again later.",
    });
  }

  return result;
}