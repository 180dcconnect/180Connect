/**
 * F065 (#67) — decision logic behind adding one comment to many clients at once,
 * kept out of the route so it can be tested without a database (same split as
 * @/lib/bulk-status, which does the pipeline-status half).
 *
 * WHY THERE IS NO RPC AND NO MIGRATION HERE, UNLIKE F064:
 * F064 needed `set_outreach_status_bulk` because direct writes to
 * `organisations.outreach_status` are revoked (F145) — the only way to move the
 * column is through a SECURITY DEFINER function that re-checks the rule. Notes are
 * the opposite: `notes` already grants INSERT to `authenticated`, and
 * `notes_insert_author` already states exactly the rule F065 wants — an active
 * user who `can_write()` (admin or CAM), writing `author_id = auth.uid()`, against
 * any client, because F019 makes the record shared. A SECURITY DEFINER RPC would
 * run as the table owner and therefore *bypass* that policy in order to
 * re-implement it in plpgsql, which is a strictly worse security posture for no
 * gain. So the write here is a plain multi-row INSERT: one statement, therefore
 * one transaction, therefore the same all-or-nothing guarantee F064 went to an RPC
 * for.
 */

export type InsertFailure = { status: number; error: string };

const GENERIC_FAILURE =
  "The comment could not be added. No client received it — refresh and try again.";

/**
 * How many clients one bulk comment may cover.
 *
 * Deliberately the same number as MAX_BULK_STATUS_CLIENTS, and deliberately
 * enforced only in the application, which is the honest difference from F064:
 * that ceiling is also inside the RPC, so a hand-built request cannot get past it,
 * whereas this one is a UI and route check that a crafted call could step around.
 * That is an accepted difference rather than an oversight. A note is additive and
 * its author can delete it, so the blast radius of an oversized batch is "too many
 * rows to tidy up", not "clients silently moved through the pipeline"; buying a
 * database-side cap would mean introducing exactly the RLS-bypassing RPC the file
 * header explains we do not want.
 */
export const MAX_BULK_NOTE_CLIENTS = 500;

/**
 * Longest comment one bulk action may carry.
 *
 * `notes.content` is `text`, so this bound exists in the app only. It is here
 * because a bulk comment is written once and stored N times: a 200KB paste
 * against 500 clients is 100MB of duplicated rows, and nobody types that on
 * purpose. Generous enough that a real paragraph of context never hits it.
 */
export const MAX_NOTE_LENGTH = 2000;

export type CommentProblem = "empty" | "too_long";

/**
 * Trims the comment and says whether what is left may be stored.
 *
 * Trimming before validating, not after, is what makes this agree with the
 * database: `notes_content_not_blank` is `length(trim(content)) > 0`, so a
 * whitespace-only comment is refused by Postgres regardless. Catching it here
 * turns a constraint violation into a sentence the CAM can act on, and the value
 * that gets written is the trimmed one either way.
 */
export function prepareComment(
  raw: string,
): { ok: true; content: string } | { ok: false; problem: CommentProblem } {
  const content = raw.trim();
  if (content.length === 0) return { ok: false, problem: "empty" };
  if (content.length > MAX_NOTE_LENGTH) return { ok: false, problem: "too_long" };
  return { ok: true, content };
}

export function commentProblemMessage(problem: CommentProblem): string {
  return problem === "empty"
    ? "Write a comment before adding it to the selected clients."
    : `A comment can be at most ${MAX_NOTE_LENGTH} characters. Shorten it and try again.`;
}

/**
 * Maps a Postgres error from the `notes` INSERT onto something safe to show a CAM.
 *
 * Same contract as setOutreachStatusBulkRpcFailure: a fixed set of codes whose
 * meaning is known here gets a written-for-humans message, and anything else gets
 * the generic string, so no stack trace, constraint name or internal detail
 * reaches the browser (DoD).
 *
 * Every message can say "no client received it" because the insert is a single
 * statement — a failure of any kind rolled the whole batch back, including the
 * rows that would have succeeded.
 */
export function bulkNoteInsertFailure(error: { code?: string; message?: string }): InsertFailure {
  switch (error.code) {
    // RLS refused the insert: not an active user, a viewer rather than a CAM, or
    // an author_id that is not the caller. The policy does not distinguish, and
    // neither should the message — it is the same "you may not do this" either way.
    case "42501":
      return {
        status: 403,
        error: "Your account cannot add comments to clients.",
      };
    // Foreign key against organisations: at least one selected id is not a client
    // any more. Most likely it was deleted while the selection sat in session
    // storage, which is exactly the case F062's cross-filter selection makes
    // possible.
    case "23503":
      return {
        status: 404,
        error:
          "One or more of the selected clients no longer exists. No comment was added — refresh the list and reselect.",
      };
    // notes_content_not_blank. prepareComment should have caught this long before
    // the database did, so reaching here means the two disagree; the CAM still
    // gets the actionable sentence rather than the constraint name.
    case "23514":
      return { status: 400, error: commentProblemMessage("empty") };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * What the CAM is told after the batch commits (AC3: confirmation of how many
 * clients received the comment).
 *
 * There is no "unchanged" half to report, unlike F064's summary: every selected
 * client gets its own note row unconditionally, because a comment is not a state
 * that can already be set. If `created` ever disagrees with `requested` something
 * is wrong rather than merely skipped, so the sentence says so instead of quietly
 * reporting the smaller number as a success.
 */
export function bulkNoteSummary(result: { requested: number; created: number }): string {
  if (result.created === result.requested) {
    return `Comment added to ${plural(result.created, "client")}.`;
  }
  return `Comment added to ${result.created} of ${plural(result.requested, "selected client")}. Refresh the list to see which.`;
}
