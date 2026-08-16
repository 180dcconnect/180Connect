"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * F062 (#64) — selecting several clients on the list view, and the shared state
 * F064's bulk bar acts on.
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
 */

const STORAGE_KEY = "180connect:clients:bulk-selection";

const EMPTY: ReadonlySet<string> = new Set<string>();

/**
 * Cached because `useSyncExternalStore` compares snapshots by identity: parsing
 * storage afresh on every render would hand React a new Set each time and loop.
 * Null means "not read yet"; every write replaces it and notifies.
 */
let snapshot: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();

function readStored(): ReadonlySet<string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    // Storage disabled, quota, or a value something else wrote. A selection is
    // not worth an error boundary — start empty and carry on.
    return EMPTY;
  }
}

function getSnapshot(): ReadonlySet<string> {
  snapshot ??= readStored();
  return snapshot;
}

/** Matches the server-rendered HTML: nothing is selected until the client says so. */
function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(next: ReadonlySet<string>): void {
  snapshot = next;
  try {
    if (next.size === 0) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Same reasoning as readStored: the in-memory selection still works, it just
    // will not survive the next navigation.
  }
  for (const listener of listeners) listener();
}

export type BulkSelection = {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  select: (ids: readonly string[]) => void;
  deselect: (ids: readonly string[]) => void;
  clear: () => void;
};

export function useBulkSelection(): BulkSelection {
  const selected = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback((id: string) => {
    const next = new Set(getSnapshot());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    write(next);
  }, []);

  const select = useCallback((ids: readonly string[]) => {
    const next = new Set(getSnapshot());
    for (const id of ids) next.add(id);
    write(next);
  }, []);

  const deselect = useCallback((ids: readonly string[]) => {
    const next = new Set(getSnapshot());
    for (const id of ids) next.delete(id);
    write(next);
  }, []);

  const clear = useCallback(() => write(EMPTY), []);

  return { selected, toggle, select, deselect, clear };
}

const BOX =
  "size-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-30";

/**
 * One row's checkbox.
 *
 * `blockedReason` non-null means this actor cannot change this client's status
 * (F064: owner or admin only), so the box is disabled rather than the selection
 * being allowed and refused later — the bulk write is all-or-nothing, so a
 * selection that cannot succeed has to be impossible to build, not merely
 * unlucky. The reason becomes the box's accessible name, so a screen reader gets
 * the same explanation the tooltip gives.
 */
export function ClientSelectCheckbox({
  clientId,
  clientName,
  blockedReason,
}: {
  clientId: string;
  clientName: string;
  blockedReason: string | null;
}) {
  const { selected, toggle } = useBulkSelection();

  return (
    <input
      type="checkbox"
      className={BOX}
      checked={selected.has(clientId)}
      disabled={blockedReason !== null}
      title={blockedReason ?? undefined}
      aria-label={blockedReason ? `${clientName} — ${blockedReason}` : `Select ${clientName}`}
      onChange={() => toggle(clientId)}
    />
  );
}

/**
 * The header checkbox: selects every selectable row **on this page**.
 *
 * "Currently visible" (F062 AC1) is read literally as the rows on screen rather
 * than every row matching the filter. Two reasons: a filter can match thousands,
 * and a control that quietly puts 4,000 clients one mis-click away from a status
 * change is the misuse F064 warns about; and a CAM can see what 25 rows are,
 * which is what makes the confirmation count mean something rather than being a
 * number they have to take on trust. Accumulating across pages still works — the
 * selection survives the navigation.
 */
export function SelectPageCheckbox({ selectableIds }: { selectableIds: readonly string[] }) {
  const { selected, select, deselect } = useBulkSelection();

  const selectedHere = selectableIds.filter((id) => selected.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectedHere === selectableIds.length;
  const someSelected = selectedHere > 0 && !allSelected;

  return (
    <input
      type="checkbox"
      className={BOX}
      checked={allSelected}
      disabled={selectableIds.length === 0}
      ref={(node) => {
        // Partial selection reads as a dash rather than as unchecked — otherwise
        // the header lies about a page where half the rows are picked. There is
        // no `indeterminate` attribute in HTML, only the DOM property, which is
        // why this is a ref callback and not a prop.
        if (node) node.indeterminate = someSelected;
      }}
      title={
        selectableIds.length === 0
          ? "None of the clients on this page are yours to change"
          : undefined
      }
      aria-label={
        allSelected ? "Deselect the clients on this page" : "Select the clients on this page"
      }
      onChange={() => (allSelected ? deselect(selectableIds) : select(selectableIds))}
    />
  );
}
