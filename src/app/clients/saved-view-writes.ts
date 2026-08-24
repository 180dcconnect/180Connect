/**
 * F066 — the decision half of the saved-view writes.
 *
 * Same split as `src/lib/onboarding-writes.ts`: a Server Action carries
 * "use server" and imports `next/cache`, so it cannot be unit-tested; what should
 * happen therefore lives here behind a small structural interface, and
 * `saved-view-actions.ts` is left with the wiring — the real client, the actor
 * lookup and the cache revalidation.
 *
 * The behaviour worth pinning down: a nameless view never reaches the database, a
 * duplicate name is an ordinary message rather than a 500, the per-user cap is
 * applied before the insert, and a delete is always scoped to the caller.
 */

import {
  MAX_SAVED_VIEWS,
  captureFilters,
  normalizeViewName,
  type SavedViewFilters,
} from "./saved-view-filters.ts";

/** The slice of the Supabase client these writes need — enough to fake in tests. */
export type SavedViewDb = {
  /** How many views this user already has. `count: null` means the read failed. */
  countViews(userId: string): Promise<{ count: number | null; error: unknown }>;
  /** Inserts a view. Returns `code: "23505"` when the name is already taken. */
  insertView(
    userId: string,
    name: string,
    filters: SavedViewFilters,
  ): Promise<{ error: { code?: string } | null }>;
  /** Deletes one of this user's views. Deleting nothing is not an error. */
  deleteView(userId: string, id: string): Promise<{ error: unknown }>;
};

export type SaveOutcome =
  | { ok: true; name: string }
  | {
      ok: false;
      reason: "invalid_name" | "duplicate_name" | "limit_reached" | "write_failed";
      error?: unknown;
    };

export type DeleteOutcome =
  | { ok: true }
  | { ok: false; reason: "missing_id" | "write_failed"; error?: unknown };

/** Postgres unique_violation — this user already has a view by that name. */
const UNIQUE_VIOLATION = "23505";
/** Postgres check_violation — the name or the filters failed a column constraint. */
const CHECK_VIOLATION = "23514";

/**
 * F066 AC1 — save the filter combination under a name.
 *
 * `filterSource` is the raw params the list was rendered from; `captureFilters` is
 * what decides which of them a view is allowed to hold, so a tampered submission
 * cannot use this table as free key-value storage.
 */
export async function saveView(
  db: SavedViewDb,
  userId: string,
  rawName: unknown,
  filterSource: Partial<Record<string, string | string[] | undefined>>,
): Promise<SaveOutcome> {
  // Checked here rather than left to the check constraint: a blank name is an
  // ordinary thing to submit by accident, and it should read as a form message
  // rather than as a database error someone has to explain in the logs.
  const name = normalizeViewName(rawName);
  if (!name) return { ok: false, reason: "invalid_name" };

  const filters = captureFilters(filterSource);

  // The per-user cap is enforced here rather than in the schema: a count constraint
  // across rows is awkward in Postgres, and this is a courtesy limit, not a security
  // one. A failed count does not block the save — losing the cap is a smaller harm
  // than refusing a legitimate view because a secondary read went wrong — and a race
  // past the cap costs one extra row.
  const { count, error: countError } = await db.countViews(userId);
  if (!countError && count !== null && count >= MAX_SAVED_VIEWS) {
    return { ok: false, reason: "limit_reached" };
  }

  const { error } = await db.insertView(userId, name, filters);
  if (!error) return { ok: true, name };
  if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: "duplicate_name" };
  if (error.code === CHECK_VIOLATION) return { ok: false, reason: "invalid_name" };
  return { ok: false, reason: "write_failed", error };
}

/**
 * F066 AC3 — delete a view the CAM no longer needs.
 *
 * Deleting a row that is not there is a success: the delete policy scopes the
 * statement to the caller's own rows, so someone else's id removes nothing and must
 * not be answerable — "no such view" and "not your view" are the same answer, which
 * is what the matrix (§4) asks for.
 */
export async function deleteView(
  db: SavedViewDb,
  userId: string,
  rawId: unknown,
): Promise<DeleteOutcome> {
  if (typeof rawId !== "string" || !rawId.trim()) {
    return { ok: false, reason: "missing_id" };
  }

  const { error } = await db.deleteView(userId, rawId);
  if (error) return { ok: false, reason: "write_failed", error };
  return { ok: true };
}
