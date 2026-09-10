"use server";

import { getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

/**
 * Per-viewer mailbox flags: star, read/unread override, trash.
 *
 * These replaced a browser-only store. The flags are per-viewer facts, so
 * localStorage was the right shape but the wrong reach — they never followed a
 * CAM to a second device and no server-side feature could read them. They live
 * in INBOX_THREAD_STATE now (migration 20260924090000).
 *
 * Nothing here checks ownership or role, and that is deliberate rather than an
 * omission: every row is keyed on the caller's own `user_id`, and the table's
 * RLS policies match own rows only for all four verbs (matrix §3.25). A
 * tampered call naming another user's id writes nothing — the policy's
 * `with check` rejects it — so the only authorisation this needs is "is there
 * an active session", which `getCurrentActor` answers.
 *
 * No audit log entries either: none of these writes changes ownership, status,
 * role or approval state (§1 of docs/audit-log-pattern.md). Starring a thread
 * changes one person's view of their own mailbox and is invisible to everyone
 * else.
 */

/** One thread's requested change. Absent fields are left as they are. */
export type InboxThreadFlagUpdate = {
  organisationId: string;
  isStarred?: boolean;
  /** `true` → read, `false` → unread, `null` → drop the override entirely. */
  read?: boolean | null;
  isTrashed?: boolean;
};

export type InboxThreadFlagResult = { ok: true } | { ok: false; message: string };

/** Postgres cannot upsert more rows than this in one statement usefully, and
    the mailbox's own page size is far below it — a bulk action on a full page
    of threads is ~50 rows. The cap is here so a hostile client cannot turn one
    call into an unbounded write. */
const MAX_UPDATES = 200;

/**
 * Applies flag changes for one or more threads.
 *
 * One action rather than one per control, because the action bar's bulk
 * operations ("mark selected read", "delete selected") are the same write as
 * the single-row ones with a longer list — and splitting them would mean a
 * 50-thread selection issuing 50 round trips.
 *
 * `upsert` on the (user_id, organisation_id) unique constraint: a thread the
 * viewer has never touched has no row yet, and toggling a star should not
 * require the client to know which case it is in. `trashed_at` is deliberately
 * not sent — the table's trigger derives it, and would overwrite anything
 * supplied.
 */
export async function applyInboxThreadFlags(
  updates: InboxThreadFlagUpdate[],
): Promise<InboxThreadFlagResult> {
  const authorization = await getCurrentActor("client:view", { route: "/inbox" });
  if (!authorization.ok) {
    return { ok: false, message: "Your session has expired. Reload and try again." };
  }
  const actor = authorization.actor;

  if (!Array.isArray(updates) || updates.length === 0) return { ok: true };
  if (updates.length > MAX_UPDATES) {
    return { ok: false, message: "Too many threads changed at once. Try a smaller selection." };
  }

  // A non-uuid organisation_id is the design fill (ids like `mock-org-oxfam`),
  // which has no organisation row to reference. Dropped rather than rejected:
  // the mailbox can hold a mix of real and fill rows while the mock set is
  // still switched on, and starring a fill row should be a no-op, not an error
  // that makes the real rows in the same click fail too.
  const rows = updates
    .filter((update) => isUuid(update.organisationId))
    .map((update) => ({
      user_id: actor.id,
      organisation_id: update.organisationId,
      ...(update.isStarred === undefined ? {} : { is_starred: update.isStarred }),
      ...(update.read === undefined
        ? {}
        : { read_state: update.read === null ? null : update.read ? "read" : "unread" }),
      ...(update.isTrashed === undefined ? {} : { is_trashed: update.isTrashed }),
    }));

  if (rows.length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("inbox_thread_state")
    .upsert(rows, { onConflict: "user_id,organisation_id" });

  if (error) {
    await reportError(error, { operation: "inbox.apply_thread_flags" });
    return { ok: false, message: "That change could not be saved. Try again." };
  }

  // Deliberately no revalidatePath: the shell applies these optimistically and
  // a refresh would re-render the whole mailbox on every star. The next
  // navigation or Refresh reads the stored rows.
  return { ok: true };
}
