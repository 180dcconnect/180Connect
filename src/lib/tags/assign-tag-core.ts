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
 * TODO: same open question as F188 — "client:edit" is used here since
 * assigning a tag is editing a client's organisation of data. No dedicated
 * "tags:assign" permission exists yet.
 */
export const ASSIGN_TAG_PERMISSION = "client:edit" as const;

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

    // A genuine failure (e.g. tagId doesn't exist -> foreign_key_violation,
    // Postgres code 23503). Testing notes explicitly call for "invalid tag"
    // coverage, so this is surfaced per-tag rather than aborting the whole
    // batch on one bad id.
    result.failed.push({ tagId, message: outcome.message });
  }

  return result;
}