"use client";

// F188/F194: create a tag, optionally picking a colour from the curated
// palette. The swatches are radios so the choice rides the same FormData
// submit as the name; "" (the default) means colourless.

import { useActionState, useState } from "react";
import { createTagFormAction } from "./tags-actions";
import type { CreateTagResult } from "@/lib/tags/create-tag-core.ts";
import { TAG_COLOURS } from "@/lib/tags/tag-colours.ts";

export function CreateTagForm() {
  const [state, action, pending] = useActionState<CreateTagResult | null, FormData>(
    createTagFormAction,
    null,
  );
  const [colour, setColour] = useState("");

  return (
    <form action={action} className="mt-6 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-black/55">Tag name</span>
        <input
          type="text"
          name="name"
          placeholder="e.g. Urgent"
          disabled={pending}
          className="rounded-xl border border-black/[0.08] px-3 py-2 text-sm"
        />
      </label>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="text-black/55">Colour</legend>
        <div className="flex items-center gap-1.5 pt-1">
          <label className="cursor-pointer" title="No colour">
            <input
              type="radio"
              name="colour"
              value=""
              checked={colour === ""}
              onChange={() => setColour("")}
              disabled={pending}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="block h-6 w-6 rounded-full border border-dashed border-black/25 bg-white opacity-60 peer-checked:opacity-100 peer-checked:ring-2 peer-checked:ring-brand peer-checked:ring-offset-1"
            />
            <span className="sr-only">No colour</span>
          </label>
          {TAG_COLOURS.map((c) => (
            <label key={c.hex} className="cursor-pointer" title={c.name}>
              <input
                type="radio"
                name="colour"
                value={c.hex}
                checked={colour === c.hex}
                onChange={() => setColour(c.hex)}
                disabled={pending}
                className="peer sr-only"
              />
              <span
                aria-hidden
                style={{ backgroundColor: c.hex }}
                className="block h-6 w-6 rounded-full opacity-40 peer-checked:opacity-100 peer-checked:ring-2 peer-checked:ring-brand peer-checked:ring-offset-1"
              />
              <span className="sr-only">{c.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create tag"}
      </button>
      {state && !state.ok && (
        <p className="w-full text-sm font-medium text-red-700" role="alert">
          {state.message}
        </p>
      )}
      {state && state.ok && (
        <p className="w-full text-sm font-medium text-brand" role="status">
          &quot;{state.tag.name}&quot; created.
        </p>
      )}
    </form>
  );
}
