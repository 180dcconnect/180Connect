"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * F062 (#64) — selecting several clients on the list view, and the shared state
 * F064's and F065's bulk actions act on.
 *
 * WHY SESSION STORAGE RATHER THAN REACT STATE:
 * /clients is a server component and every filter, sort and page link on it is a
 * real navigation, so React state on that tree is thrown away each time the CAM
 * narrows the list — precisely the moment a selection is most likely to be half
 * built. F062 AC3 asks for a selection that either survives a filter change or is
 * visibly cleared, never one that silently disappears; keeping the ids in
 * `sessionStorage` makes the first of those true. Session, not local: a selection
 * is something you are doing right now, and it should not still be waiting for
 * you tomorrow morning in a new tab.
 *
 * WHY A MODULE STORE AND useSyncExternalStore RATHER THAN A CONTEXT PROVIDER:
 * `sessionStorage` *is* an external store, and reading it during render is what
 * would desync the server's HTML from the client's first paint. This is the hook
 * built for that: the server snapshot is empty (matching the HTML), the client
 * snapshot is the stored selection, and React reconciles the two itself rather
 * than us doing it in an effect that sets state — which is a cascading render
 * and, worse, a frame where the bar says "0 selected" to a CAM who has 12.
 *
 * A consequence worth being explicit about: the selection can hold clients the
 * current filter does not show. That is the point — filter to Leeds, select four,
 * filter to Bristol, select three, apply to all seven — so the count in the bar is
 * the total selected rather than the number visible right now, and the bar says so.
 *
 * WHY THE SELECTION CARRIES A FLAG PER CLIENT (F065):
 * It started as a plain set of ids because there was one bulk action and one
 * permission rule behind it: F064's status change needs owner-or-admin, so a row
 * the actor could not change was simply not selectable, and a selection that was
 * certain to be refused could not be built. F065 added a second action with a
 * *wider* rule — `notes_insert_author` lets any active CAM comment on any client,
 * because F019 makes the record shared — and the two no longer agree on which
 * rows belong in a selection. Gating the checkbox on the narrower rule would mean
 * a CAM cannot comment on a client they do not own, which is a permission the
 * database grants and the UI would be inventing a restriction on.
 *
 * So selectability is now the *wider* rule (anyone who can reach the checkbox at
 * all), and the narrower one rides along per client as `canStatus`. F064's
 * guarantee survives in the place it matters: the bar knows, for the whole
 * selection and across every page and filter it spans, how many rows the actor
 * cannot move, and refuses the status action with that count rather than letting
 * an atomic write be attempted and refused. What changes is only *which control*
 * says no, and it now says no with a number in it.
 */

const STORAGE_KEY = "180connect:clients:bulk-selection";

/** id → whether this actor may also bulk-change that client's pipeline status. */
export type SelectionMap = ReadonlyMap<string, boolean>;

export type SelectableClient = { id: string; canStatus: boolean };

const EMPTY: SelectionMap = new Map<string, boolean>();

/**
 * Cached because `useSyncExternalStore` compares snapshots by identity: parsing
 * storage afresh on every render would hand React a new Map each time and loop.
 * Null means "not read yet"; every write replaces it and notifies.
 */
let snapshot: SelectionMap | null = null;
const listeners = new Set<() => void>();

function readStored(): SelectionMap {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    // The array form is what F062 stored before F065 gave each entry a flag. A
    // CAM mid-selection when the deploy lands still has one in their tab, and
    // every id in it was status-capable by construction — that was the old
    // selectability rule — so reading them back as `true` is not a guess.
    if (Array.isArray(parsed)) {
      return new Map(
        parsed.filter((id): id is string => typeof id === "string").map((id) => [id, true]),
      );
    }
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    return new Map(
      Object.entries(parsed as Record<string, unknown>).map(([id, canStatus]) => [
        id,
        canStatus === true,
      ]),
    );
  } catch {
    // Storage disabled, quota, or a value something else wrote. A selection is
    // not worth an error boundary — start empty and carry on.
    return EMPTY;
  }
}

function getSnapshot(): SelectionMap {
  snapshot ??= readStored();
  return snapshot;
}

/** Matches the server-rendered HTML: nothing is selected until the client says so. */
function getServerSnapshot(): SelectionMap {
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(next: SelectionMap): void {
  snapshot = next;
  try {
    if (next.size === 0) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(next)));
  } catch {
    // Same reasoning as readStored: the in-memory selection still works, it just
    // will not survive the next navigation.
  }
  for (const listener of listeners) listener();
}

export type BulkSelection = {
  selected: SelectionMap;
  /** Every selected id, in insertion order. What a bulk request sends. */
  ids: string[];
  /** How many selected clients this actor may *not* bulk-change the status of. */
  statusBlockedCount: number;
  toggle: (client: SelectableClient) => void;
  select: (clients: readonly SelectableClient[]) => void;
  deselect: (ids: readonly string[]) => void;
  clear: () => void;
};

export function useBulkSelection(): BulkSelection {
  const selected = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(({ id, canStatus }: SelectableClient) => {
    const next = new Map(getSnapshot());
    if (next.has(id)) next.delete(id);
    else next.set(id, canStatus);
    write(next);
  }, []);

  const select = useCallback((clients: readonly SelectableClient[]) => {
    const next = new Map(getSnapshot());
    for (const { id, canStatus } of clients) next.set(id, canStatus);
    write(next);
  }, []);

  const deselect = useCallback((ids: readonly string[]) => {
    const next = new Map(getSnapshot());
    for (const id of ids) next.delete(id);
    write(next);
  }, []);

  const clear = useCallback(() => write(EMPTY), []);

  const ids = [...selected.keys()];
  let statusBlockedCount = 0;
  for (const canStatus of selected.values()) if (!canStatus) statusBlockedCount += 1;

  return { selected, ids, statusBlockedCount, toggle, select, deselect, clear };
}

const BOX =
  "size-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-30";

/**
 * One row's checkbox.
 *
 * Always enabled — the column only renders for actors who can act on clients at
 * all, and every such actor can comment on every client (F065). `statusNote`,
 * when set, says why the *status* action will not cover this row; it is a hint on
 * a usable control rather than the reason a disabled one exists, so it goes into
 * the accessible name after the client's own name rather than replacing it.
 */
export function ClientSelectCheckbox({
  clientId,
  clientName,
  canStatus,
  statusNote,
}: {
  clientId: string;
  clientName: string;
  canStatus: boolean;
  statusNote: string | null;
}) {
  const { selected, toggle } = useBulkSelection();

  return (
    <input
      type="checkbox"
      className={BOX}
      checked={selected.has(clientId)}
      title={statusNote ?? undefined}
      aria-label={statusNote ? `Select ${clientName} — ${statusNote}` : `Select ${clientName}`}
      onChange={() => toggle({ id: clientId, canStatus })}
    />
  );
}

/**
 * The header checkbox: selects every row **on this page**.
 *
 * "Currently visible" (F062 AC1) is read literally as the rows on screen rather
 * than every row matching the filter. Two reasons: a filter can match thousands,
 * and a control that quietly puts 4,000 clients one mis-click away from a status
 * change is the misuse F064 warns about; and a CAM can see what 25 rows are,
 * which is what makes the confirmation count mean something rather than being a
 * number they have to take on trust. Accumulating across pages still works — the
 * selection survives the navigation.
 */
export function SelectPageCheckbox({ clients }: { clients: readonly SelectableClient[] }) {
  const { selected, select, deselect } = useBulkSelection();

  const selectedHere = clients.filter((client) => selected.has(client.id)).length;
  const allSelected = clients.length > 0 && selectedHere === clients.length;
  const someSelected = selectedHere > 0 && !allSelected;

  return (
    <input
      type="checkbox"
      className={BOX}
      checked={allSelected}
      disabled={clients.length === 0}
      ref={(node) => {
        // Partial selection reads as a dash rather than as unchecked — otherwise
        // the header lies about a page where half the rows are picked. There is
        // no `indeterminate` attribute in HTML, only the DOM property, which is
        // why this is a ref callback and not a prop.
        if (node) node.indeterminate = someSelected;
      }}
      aria-label={
        allSelected ? "Deselect the clients on this page" : "Select the clients on this page"
      }
      onChange={() =>
        allSelected ? deselect(clients.map((client) => client.id)) : select(clients)
      }
    />
  );
}
