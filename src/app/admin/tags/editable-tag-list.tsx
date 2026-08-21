"use client";

// F189: existing tags list with inline rename (admin-only, enforced
// server-side regardless of what this UI shows). Clicking a tag's name
// turns it into an editable field; saving calls editTagAction and updates
// the name in place, no page reload — renaming here only ever touches the
// tags row itself, so every existing client assignment survives under the
// new name automatically (AC1, AC2).

import { useState, useTransition } from "react";
import { editTagAction } from "@/lib/tags/edit-tag-action";

export type EditableTagEntry = { id: string; name: string };

export function EditableTagList({
  initialTags,
}: {
  initialTags: EditableTagEntry[];
}) {
  const [tags, setTags] = useState(initialTags);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pending, startTransition] = useTransition();
  const [errorByTagId, setErrorByTagId] = useState<Record<string, string>>({});

  function startEditing(tag: EditableTagEntry) {
    setEditingId(tag.id);
    setDraftName(tag.name);
    setErrorByTagId((prev) => {
      const next = { ...prev };
      delete next[tag.id];
      return next;
    });
  }

  function cancelEditing() {
    setEditingId(null);
    setDraftName("");
  }

  function saveEdit(tagId: string) {
    startTransition(async () => {
      const result = await editTagAction(tagId, draftName);
      if (result.ok) {
        setTags((current) =>
          current.map((t) => (t.id === tagId ? { ...t, name: result.tag.name } : t)),
        );
        setEditingId(null);
      } else {
        setErrorByTagId((prev) => ({ ...prev, [tagId]: result.message }));
      }
    });
  }

  if (tags.length === 0) {
    return <p className="mt-3 text-sm text-black/50">No tags created yet.</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {tags.map((tag) => (
        <div key={tag.id} className="flex flex-wrap items-center gap-2">
          {editingId === tag.id ? (
            <>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                disabled={pending}
                className="rounded-full border border-black/20 px-2.5 py-1 text-xs"
                autoFocus
              />
              <button
                type="button"
                onClick={() => saveEdit(tag.id)}
                disabled={pending}
                className="text-xs font-bold text-[--brand] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={pending}
                className="text-xs font-medium text-black/40 hover:text-black/60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="rounded-full bg-[--brand]/10 px-2.5 py-1 text-xs font-medium text-[--brand]">
                {tag.name}
              </span>
              <button
                type="button"
                onClick={() => startEditing(tag)}
                className="text-xs font-medium text-black/40 hover:text-[--brand]"
              >
                Edit
              </button>
            </>
          )}
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
