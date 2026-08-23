"use client";

import { useActionState } from "react";
import { createTagFormAction } from "./tags-actions";
import type { CreateTagResult } from "@/lib/tags/create-tag-core.ts";

export function CreateTagForm() {
  const [state, action, pending] = useActionState<CreateTagResult | null, FormData>(
    createTagFormAction,
    null,
  );

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
