"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import type { SavedViewSummary } from "./saved-views-panel";

const initialState: SavedViewState = { status: "idle" };

export function SavedViewsPopover({
  views,
  activeFilters,
  hasActiveFilters,
  variant = "default",
}: {
  views: SavedViewSummary[];
  activeFilters: SavedViewFilters;
  hasActiveFilters: boolean;
  variant?: "default" | "inline";
}) {
  const [open, setOpen] = useState(false);
  const [saveState, saveFormAction, saving] = useActionState(
    async (prev: SavedViewState, formData: FormData) => {
      const result = await saveViewAction(prev, formData);
      return result;
    },
    initialState,
  );

  const currentView = views.find((v) => v.isCurrent);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "inline" ? (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-brand hover:underline focus-visible:outline-none"
          >
            <Bookmark className="h-3.5 w-3.5" />
            <span>Save view</span>
          </button>
        ) : (
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-bold shadow-xs transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              currentView
                ? "border-brand/40 bg-brand/[0.06] text-brand hover:bg-brand/[0.1]"
                : "border-black/[0.08] bg-white text-foreground/80 hover:bg-black/[0.03] hover:text-foreground"
            }`}
          >
            <Bookmark className={`h-3.5 w-3.5 ${currentView ? "text-brand fill-brand/20" : "text-foreground/50"}`} />
            <span>{currentView ? currentView.name : "Saved views"}</span>
            {views.length > 0 && !currentView && (
              <span className="rounded-full bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/70">
                {views.length}
              </span>
            )}
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-black/[0.08] bg-white p-4 shadow-xl text-foreground"
      >
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-brand" />
            <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/60">
              Saved views
            </h3>
          </div>
          {views.length > 0 && (
            <span className="text-[11px] font-semibold text-foreground/40">
              {views.length} saved
            </span>
          )}
        </div>

        {views.length > 0 ? (
          <ul className="my-3 max-h-[14rem] space-y-1 overflow-y-auto pr-1">
            {views.map((view) => (
              <li
                key={view.id}
                className={`flex items-center gap-2.5 rounded-xl border p-2.5 transition-colors ${
                  view.isCurrent
                    ? "border-brand/30 bg-brand/[0.04]"
                    : "border-black/[0.05] hover:bg-black/[0.02]"
                }`}
              >
                <Link
                  href={view.href}
                  onClick={() => setOpen(false)}
                  aria-current={view.isCurrent ? "true" : undefined}
                  className="min-w-0 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold text-foreground">
                      {view.name}
                    </span>
                    {view.isCurrent && (
                      <span className="rounded-full bg-brand/10 px-2 py-0.2 text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-brand">
                        Showing
                      </span>
                    )}
                  </div>
                  <span className="block truncate text-[11px] text-foreground/50">
                    {view.description}
                  </span>
                </Link>
                <DeleteViewButton id={view.id} name={view.name} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="my-4 text-xs leading-relaxed text-foreground/50">
            No saved views yet. Filter the list below, then name and save your view.
          </p>
        )}

        <div className="border-t border-black/[0.06] pt-3">
          <form action={saveFormAction} className="flex flex-col gap-2">
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

            <div className="flex items-center gap-2">
              <input
                id="saved-view-name"
                name="name"
                type="text"
                required
                maxLength={MAX_VIEW_NAME_LENGTH}
                placeholder={
                  hasActiveFilters ? "Name this filter combination" : "Name this view"
                }
                className="min-w-0 flex-1 rounded-xl border border-black/[0.08] bg-black/[0.02] px-3 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-brand"
              />
              <button
                type="submit"
                disabled={saving}
                className="shrink-0 cursor-pointer rounded-xl bg-foreground px-3.5 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save view"}
              </button>
            </div>

            {!hasActiveFilters && (
              <p className="text-[10.5px] text-foreground/40">
                No filters are active, so this saves the whole list.
              </p>
            )}

            {saveState.status !== "idle" && saveState.message && (
              <p
                role="status"
                className={`text-[11px] font-bold ${
                  saveState.status === "error" ? "text-destructive" : "text-brand"
                }`}
              >
                {saveState.message}
              </p>
            )}
          </form>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DeleteViewButton({ id, name }: { id: string; name: string }) {
  const [state, formAction, pending] = useActionState(deleteViewAction, initialState);

  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        title={`Delete saved view "${name}"`}
        aria-label={`Delete saved view "${name}"`}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-foreground/35 transition-colors hover:bg-black/[0.04] hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      {state.status === "error" && state.message && (
        <span role="alert" className="sr-only">
          {state.message}
        </span>
      )}
    </form>
  );
}
