"use client";

// F190: existing tags list with delete (admin-only, enforced server-side
// regardless of what this UI shows). AC1: only after confirming — a click
// arms a confirm state; a second click within the same render actually
// deletes. AC2: if the tag is in use, deleteTagCore blocks the delete and
// returns a message with the assignment count, shown here rather than a
// silent failure.

import { useState, useTransition } from "react";
import { deleteTagAction } from "@/lib/tags/delete-tag-action";

export type TagListEntry = { id: string; name: string };

export function TagList({ initialTags }: { initialTags: TagListEntry[] }) {
  const [tags, setTags] = useState(initialTags);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [errorByTagId, setErrorByTagId] = useState<Record<string, string>>({});

  function handleDeleteClick(tagId: string) {
    if (confirmingId !== tagId) {
      // First click: arm the confirmation, per AC1 — never delete on a
      // single click.
      setConfirmingId(tagId);
      return;
    }

    setErrorByTagId((prev) => {
      const next = { ...prev };
      delete next[tagId];
      return next;
    });

    startTransition(async () => {
      const result = await deleteTagAction(tagId);
      if (result.ok) {
        setTags((current) => current.filter((t) => t.id !== tagId));
      } else {
        setErrorByTagId((prev) => ({ ...prev, [tagId]: result.message }));
      }
      setConfirmingId(null);
    });
  }

  if (tags.length === 0) {
    return <p className="mt-3 text-sm text-black/50">No tags created yet.</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {tags.map((tag) => (
        <div key={tag.id} className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[--brand]/10 px-2.5 py-1 text-xs font-medium text-[--brand]">
            {tag.name}
          </span>
          <button
            type="button"
            onClick={() => handleDeleteClick(tag.id)}
            disabled={pending}
            className={`text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
              confirmingId === tag.id
                ? "text-red-700 underline"
                : "text-black/40 hover:text-red-700"
            }`}
          >
            {confirmingId === tag.id ? "Click again to confirm delete" : "Delete"}
          </button>
          {errorByTagId[tag.id] && (
            <span className="w-full text-xs font-medium text-red-700" role="alert">
              {errorByTagId[tag.id]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
