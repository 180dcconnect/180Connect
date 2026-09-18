/**
 * Per-viewer thread flags — starred, read, trashed.
 *
 * These three are per-VIEWER facts. `real-threads.ts` cannot supply them: it
 * hands every thread `isStarred: false` and derives `isRead` from whether the
 * newest event is an unanswered reply, because neither is a property of the
 * organisation — they are properties of one person's relationship to it. They
 * are stored in INBOX_THREAD_STATE (migration 20260924090000), read by the
 * page and written by the `applyInboxThreadFlags` server action.
 *
 * This file was briefly a localStorage store, which was the right SHAPE (the
 * flags are per-viewer) but the wrong REACH: they never followed a CAM to a
 * second device and no server-side feature could read them. The two functions
 * the shell talks to are unchanged across that swap, which is what the store
 * was shaped for.
 *
 * The store is optimistic on purpose. A star must land on the row the instant
 * it is clicked — waiting on a round trip to paint a filled star is the kind
 * of latency that makes a mailbox feel broken — so the snapshot updates first
 * and the write follows. A failed write rolls that snapshot back, because a
 * star that silently did not persist is worse than one that visibly refused.
 */

export type ThreadFlags = {
  starred: Set<string>;
  read: Set<string>;
  unread: Set<string>;
  trashed: Set<string>;
};

export function emptyThreadFlags(): ThreadFlags {
  return { starred: new Set(), read: new Set(), unread: new Set(), trashed: new Set() };
}

/** One INBOX_THREAD_STATE row, as the page selects it. */
export type InboxThreadStateRow = {
  organisation_id: string;
  is_starred: boolean;
  read_state: "read" | "unread" | null;
  is_trashed: boolean;
};

/** The stored rows, folded into the four sets the overlay works on. */
export function threadFlagsFromRows(rows: readonly InboxThreadStateRow[]): ThreadFlags {
  const flags = emptyThreadFlags();
  for (const row of rows) {
    if (row.is_starred) flags.starred.add(row.organisation_id);
    if (row.read_state === "read") flags.read.add(row.organisation_id);
    if (row.read_state === "unread") flags.unread.add(row.organisation_id);
    if (row.is_trashed) flags.trashed.add(row.organisation_id);
  }
  return flags;
}

/**
 * Lays the stored flags over threads as they arrived from the server.
 *
 * `read` and `unread` are two sets rather than one, because both directions
 * are overrides: a thread the server calls unread (an unanswered reply) that
 * the CAM has read needs to stay read, and a thread they marked unread on
 * purpose must not be flipped back by the server's derivation. Anything in
 * neither set keeps whatever the server decided.
 *
 * Trashing is applied by moving the thread's folder, which is what the shell's
 * own delete does, so the Trash folder and its empty state work unchanged.
 */
export function applyThreadFlags<
  T extends { id: string; isStarred: boolean; isRead: boolean; folder: string },
>(threads: readonly T[], flags: ThreadFlags): T[] {
  return threads.map((thread) => {
    const isStarred = flags.starred.has(thread.id) || thread.isStarred;
    const isRead = flags.read.has(thread.id)
      ? true
      : flags.unread.has(thread.id)
        ? false
        : thread.isRead;
    const folder = flags.trashed.has(thread.id) ? "trash" : thread.folder;
    if (isStarred === thread.isStarred && isRead === thread.isRead && folder === thread.folder) {
      return thread;
    }
    return { ...thread, isStarred, isRead, folder };
  });
}


/* ---------------------------------------------------------------------------
 * The store the shell subscribes to.
 *
 * `useSyncExternalStore` rather than component state: the flags are shared by
 * the thread list, the reading pane and the action bar, and every one of them
 * needs the same answer within the same paint. A snapshot is cached and only
 * replaced when something actually changes, because `getSnapshot` must return
 * a referentially stable value between changes or React re-renders forever.
 *
 * Seeded from the server by `seedThreadFlags`, which the shell calls during
 * render rather than in an effect — an effect would mean one paint with no
 * flags at all, so every starred thread would flicker unstarred on load.
 * ------------------------------------------------------------------------- */

const listeners = new Set<() => void>();
const SERVER_SNAPSHOT = emptyThreadFlags();
let snapshot: ThreadFlags = SERVER_SNAPSHOT;
/** The rows the current snapshot was seeded from, so a re-seed with the same
    server data is a no-op rather than an infinite render loop. */
let seededFrom: readonly InboxThreadStateRow[] | null = null;

function emit(next: ThreadFlags): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribeToThreadFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getThreadFlagsSnapshot(): ThreadFlags {
  return snapshot;
}

/** Used for the server render and during hydration, where there is no store. */
export function getThreadFlagsServerSnapshot(): ThreadFlags {
  return SERVER_SNAPSHOT;
}

/**
 * Adopts the flags the page read from the database.
 *
 * Identity-compared against the rows it last adopted, so calling this on every
 * render is safe: only a genuinely new array from the server replaces the
 * snapshot. That matters because a refresh hands down new rows and the store
 * has to follow, while an ordinary re-render must not throw away an optimistic
 * change that has not been confirmed yet.
 */
export function seedThreadFlags(rows: readonly InboxThreadStateRow[]): void {
  if (seededFrom === rows) return;
  seededFrom = rows;
  snapshot = threadFlagsFromRows(rows);
}

/**
 * Applies a change locally, then persists it.
 *
 * The optimistic snapshot goes in first and the write follows. If the write
 * fails the previous snapshot is put back and `onError` is told, so the star
 * visibly returns to where it was rather than sitting there as a lie. The
 * persist function is injected so this module needs no import of the server
 * action — which keeps it usable from a unit test without a Supabase session.
 */
export async function updateThreadFlags(
  update: (previous: ThreadFlags) => ThreadFlags,
  persist: () => Promise<{ ok: boolean; message?: string }>,
  onError?: (message: string) => void,
): Promise<void> {
  const previous = snapshot;
  emit(update(previous));
  try {
    const result = await persist();
    if (!result.ok) {
      emit(previous);
      onError?.(result.message ?? "That change could not be saved.");
    }
  } catch {
    emit(previous);
    onError?.("That change could not be saved. Check your connection.");
  }
}

/** Test seam: drops all state so one test cannot leak into the next. */
export function resetThreadFlagsStoreForTests(): void {
  snapshot = emptyThreadFlags();
  seededFrom = null;
  listeners.clear();
}
