"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  MAX_VIEW_NAME_LENGTH,
  SAVED_VIEW_FILTER_KEYS,
  type SavedViewFilters,
} from "./saved-view-filters";
import {
  deleteViewAction,
  saveViewAction,
  type SavedViewState,
} from "./saved-view-actions";

/**
 * F066 (#68) — the saved views strip above the client list.
 *
 * One row per view the CAM has saved, each a plain link: selecting a view is a
 * navigation to the URL its filters describe (see saved-view-filters.ts), so the
 * list it lands on is built by exactly the same filter functions that built the list
 * when it was saved. Nothing here re-queries or re-interprets anything.
 *
 * Client component only because the two forms want their result in place —
 * "already have a view called X", "saved" — rather than as a redirect that would
 * throw away the filters the CAM is standing in. The links themselves are ordinary
 * anchors and work without any of it.
 */

const initialState: SavedViewState = { status: "idle" };

export type SavedViewSummary = {
  id: string;
  name: string;
  filters: SavedViewFilters;
  href: string;
  description: string;
  isCurrent: boolean;
};

export function SavedViewsPanel({
  views,
  activeFilters,
  hasActiveFilters,
}: {
  views: SavedViewSummary[];
  /** The filters the list on screen was built from — what "save" will store. */
  activeFilters: SavedViewFilters;
  hasActiveFilters: boolean;
}) {
  const [saveState, saveFormAction, saving] = useActionState(saveViewAction, initialState);

  return (
    <section
      aria-labelledby="saved-views-heading"
      className="rounded-2xl border border-black/[0.06] bg-white px-5 py-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="saved-views-heading"
          className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35"
        >
          Saved views
        </h2>
        {views.length > 0 && (
          <p className="text-[11px] text-foreground/35">
            {views.length} saved
          </p>
        )}
      </div>

      {views.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {views.map((view) => (
            <li
              key={view.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
                view.isCurrent
                  ? "border-brand/30 bg-brand/[0.04]"
                  : "border-black/[0.06] hover:bg-black/[0.02]"
              }`}
            >
              <Link
                href={view.href}
                aria-current={view.isCurrent ? "true" : undefined}
                className="min-w-0 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span className="block truncate text-sm font-bold">
                  {view.name}
                  {view.isCurrent && (
                    <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-[0.12em] text-brand">
                      Showing
                    </span>
                  )}
                </span>
                <span className="block truncate text-[12px] text-foreground/50">
                  {view.description}
                </span>
              </Link>
              <DeleteViewButton id={view.id} name={view.name} />
            </li>
          ))}
        </ul>
      )}

      {views.length === 0 && (
        <p className="mt-2 text-sm leading-[1.7] text-foreground/50">
          No saved views yet. Filter the list, then name and save the combination to
          come back to it.
        </p>
      )}

      <form action={saveFormAction} className="mt-3 flex flex-wrap items-center gap-2">
        {/* What the view will store: the filters this page was rendered with. A
            server action has no URL of its own, so the params travel with the form
            — the same set the list above was built from, no re-derivation. A
            multi-select key writes one input per chosen value, the same repeated
            param the page's own links write. */}
        {SAVED_VIEW_FILTER_KEYS.flatMap((key) => {
          const value = activeFilters[key];
          if (Array.isArray(value)) {
            return value.map((entry) => (
              <input key={`${key}-${entry}`} type="hidden" name={key} value={entry} />
            ));
          }
          return value ? (
            [<input key={key} type="hidden" name={key} value={value} />]
          ) : [];
        })}

        <label htmlFor="saved-view-name" className="sr-only">
          Name for this filter combination
        </label>
        <input
          id="saved-view-name"
          name="name"
          type="text"
          required
          maxLength={MAX_VIEW_NAME_LENGTH}
          placeholder={
            hasActiveFilters ? "Name this filter combination" : "Name this view"
          }
          className="min-w-0 flex-1 rounded-xl border border-black/[0.08] bg-black/[0.015] px-3 py-2 text-sm placeholder:text-foreground/35 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-brand"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save view"}
        </button>
      </form>

      {/* Saving an unfiltered list is allowed — it is a legitimate "back to
          everything" shortcut — but it is worth saying what will be stored, since
          the button reads the same either way. */}
      {!hasActiveFilters && (
        <p className="mt-2 text-[12px] text-foreground/40">
          No filters are active, so this would save the whole list.
        </p>
      )}

      {saveState.status !== "idle" && saveState.message && (
        <p
          role="status"
          className={`mt-2 text-[12px] font-bold ${
            saveState.status === "error" ? "text-destructive" : "text-foreground/50"
          }`}
        >
          {saveState.message}
        </p>
      )}
    </section>
  );
}

/**
 * Deleting is its own form per row so each row reports its own failure, and so a
 * failed delete on one view cannot blank the message of another. No confirm dialog:
 * a saved view holds no client data and re-saving one is typing a name, so a
 * confirmation step here would cost more than the mistake it prevents.
 */
function DeleteViewButton({ id, name }: { id: string; name: string }) {
  const [state, formAction, pending] = useActionState(deleteViewAction, initialState);

  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg px-2 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35 transition-colors hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
        <span className="sr-only"> saved view {name}</span>
      </button>
      {state.status === "error" && state.message && (
        <span role="alert" className="sr-only">
          {state.message}
        </span>
      )}
    </form>
  );
}
