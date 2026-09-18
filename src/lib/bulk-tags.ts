/**
 * F063 (#65) — decision logic behind applying one or more existing tags to many
 * clients at once, kept out of the route so it can be tested without a database
 * (same split as @/lib/bulk-note and @/lib/bulk-status).
 *
 * WHY THERE IS NO RPC AND NO MIGRATION HERE, UNLIKE F064:
 * `org_tags` grants INSERT to `authenticated` through its RLS policy
 * (`app.is_active_user() and app.can_write() and added_by_user_id = auth.uid()`),
 * which is exactly the rule F063 wants — a CAM or admin attributing the
 * assignment to themselves, against any client, because tag assignment is
 * deliberately not scoped per-client ownership (F191's call: the gate is
 * `tags:manage`, not `client:edit`). A SECURITY DEFINER RPC would run as the
 * table owner and therefore bypass that policy in order to re-implement it in
 * plpgsql — strictly worse security for no gain. So the write is one plain
 * multi-row INSERT: one statement, therefore one transaction, therefore either
 * every selected client is tagged or none is.
 *
 * AC2 (no duplicate assignments) is enforced by the database itself:
 * org_tags_unique_assignment on (organisation_id, tag_id). The insert runs with
 * ignoreDuplicates against that constraint, so a client that already has a
 * chosen tag simply contributes no new row — a no-op, never an error.
 */

import type { InsertFailure } from "./bulk-note.ts";

/**
 * How many clients one bulk tagging may cover. Deliberately the same number as
 * MAX_BULK_STATUS_CLIENTS and MAX_BULK_NOTE_CLIENTS so every bulk action on the
 * bar behaves the same way, and enforced only in the app, for the same reason
 * as the note cap (@/lib/bulk-note): tagging is additive and reversible via
 * F192's remove action, so the blast radius of an oversized batch is "too many
 * rows to tidy up", not a silent state change worth an RLS-bypassing RPC.
 */
export const MAX_BULK_TAG_CLIENTS = 500;

/**
 * How many distinct tags one bulk action may apply at once. Tags are a small,
 * admin-curated list (F188), so this bound exists to stop a hand-built request
 * expanding the cross product ids x tagIds into an absurd payload, not because
 * a CAM could realistically pick this many.
 */
export const MAX_BULK_TAG_TAGS = 100;

export type BulkTagRow = {
  organisation_id: string;
  tag_id: string;
  added_by_user_id: string;
};

/**
 * Builds the rows for the batch insert: the full cross product of selected
 * clients x chosen tags, attributed to the caller.
 *
 * Deduping both inputs first mirrors /api/clients/bulk-note: the UI cannot
 * produce duplicates (the selection is a Set, the picker is checkboxes), but
 * the route is a public surface, and deduping keeps `requested` equal to the
 * number of clients the confirmation message talks about.
 */
export function buildBulkTagRows(
  organisationIds: string[],
  tagIds: string[],
  addedByUserId: string,
): BulkTagRow[] {
  const uniqueOrganisationIds = [...new Set(organisationIds)];
  const uniqueTagIds = [...new Set(tagIds)];
  const rows: BulkTagRow[] = [];
  for (const organisationId of uniqueOrganisationIds) {
    for (const tagId of uniqueTagIds) {
      rows.push({ organisation_id: organisationId, tag_id: tagId, added_by_user_id: addedByUserId });
    }
  }
  return rows;
}

/**
 * Maps a Postgres error from the org_tags INSERT onto something safe to show a
 * CAM. Same contract as bulkNoteInsertFailure: known codes get a sentence
 * written for humans; anything else gets the generic string, so no stack
 * trace, constraint name or internal detail reaches the browser (DoD).
 */
export function bulkTagsInsertFailure(error: { code?: string; message?: string }): InsertFailure {
  switch (error.code) {
    // RLS refused the insert: not an active user, a viewer rather than a CAM,
    // or an added_by_user_id that is not the caller. The policy does not
    // distinguish, and neither should the message.
    case "42501":
      return { status: 403, error: "Your account cannot assign tags to clients." };
    // Foreign key against organisations or tags: a selected id no longer
    // exists. Most likely a client was deleted while the F062 selection sat in
    // session storage, or a tag was deleted (F190) while the picker was open.
    case "23503":
      return {
        status: 404,
        error:
          "One or more of the selected clients or tags no longer exists. Nothing was tagged — refresh the list and try again.",
      };
    default:
      return {
        status: 500,
        error: "The tags could not be applied. No client was tagged — refresh and try again.",
      };
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * What the CAM is told after the batch commits (AC3: confirmation of how many
 * clients were successfully tagged).
 *
 * "Tagged" means at least one new assignment was created on that client. A
 * client that already had every chosen tag contributed no row (AC2), so it is
 * reported as skipped rather than silently counted as a success — but it is
 * also not a failure, which is why the message says "already had" rather than
 * sending the CAM to hunt for what went wrong.
 */
export function bulkTagsSummary(result: {
  requested: number;
  tagged: number;
  unchanged: number;
}): string {
  if (result.tagged === result.requested) {
    return `Tags applied to ${plural(result.tagged, "client")}.`;
  }
  if (result.tagged === 0) {
    return result.requested === 1
      ? "That client already has every selected tag — nothing was changed."
      : `None of the ${plural(result.requested, "selected client")} were new to these tags — they already have all of them.`;
  }
  return `Tags applied to ${result.tagged} of ${plural(result.requested, "selected client")}. ${
    result.unchanged === 1
      ? "The other client already has every selected tag."
      : `The other ${result.unchanged} clients already have every selected tag.`
  }`;
}
