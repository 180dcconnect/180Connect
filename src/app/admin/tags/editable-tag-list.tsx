"use client";

// F189/F194: existing tags list with inline rename (admin-only, enforced
// server-side regardless of what this UI shows) and inline recolour (F194,
// any CAM or admin — enforced by the set_tag_colour RPC server-side).
// Clicking a tag's name turns it into an editable field; saving calls
// editTagAction and updates the name in place, no page reload — renaming
// here only ever touches the tags row itself, so every existing client
// assignment survives under the new name automatically (F189 AC1, AC2).

import { useState, useTransition } from "react";
import { editTagAction } from "@/lib/tags/edit-tag-action";
import { setTagColourAction } from "@/lib/tags/set-tag-colour-action.ts";
import { TAG_COLOURS, tagPillStyle } from "@/lib/tags/tag-colours.ts";

export type EditableTagEntry = { id: string; name: string; colour: string | null };

export function EditableTagList({
  initialTags,
}: {
  initialTags: EditableTagEntry[];
}) {
  const [tags, setTags] = useState(initialTags);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [colourId, setColourId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [errorByTagId, setErrorByTagId] = useState<Record<string, string>>({});

  function clearError(tagId: string) {
    setErrorByTagId((prev) => {
      const next = { ...prev };
      delete next[tagId];
      return next;
    });
  }

  function startEditing(tag: EditableTagEntry) {
    setEditingId(tag.id);
    setDraftName(tag.name);
    setColourId(null);
    clearError(tag.id);
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

  // F194 AC3: recolouring is open to every tags:manage holder — CAMs
  // included. The RPC refuses anyone the app gate would, so this UI can
  // offer it unconditionally.
  function saveColour(tagId: string, colour: string | null) {
    setColourId(null);
    startTransition(async () => {
      try {
        const result = await setTagColourAction(tagId, colour);
        if (!result.ok) {
          setErrorByTagId((prev) => ({ ...prev, [tagId]: result.message }));
          return;
        }
        setTags((current) =>
          current.map((t) =>
            t.id === tagId ? { ...t, colour: result.tag.colour } : t,
          ),
        );
      } catch {
        setErrorByTagId((prev) => ({
          ...prev,
          [tagId]: "The colour could not be saved. Please try again later.",
        }));
      }
    });
  }

  if (tags.length === 0) {
    return <p className="mt-3 text-sm text-black/50">No tags created yet.</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {tags.map((tag) => {
        const pillStyle = tagPillStyle(tag.colour);
        return (
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
                <span
                  style={pillStyle ?? undefined}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    pillStyle
                      ? ""
                      : "bg-[--brand]/10 text-[--brand]"
                  }`}
                >
                  {tag.name}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    colourId === tag.id ? setColourId(null) : setColourId(tag.id)
                  }
                  disabled={pending}
                  aria-expanded={colourId === tag.id}
                  className="text-xs font-medium text-black/40 hover:text-[--brand] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Colour
                </button>
                <button
                  type="button"
                  onClick={() => startEditing(tag)}
                  className="text-xs font-medium text-black/40 hover:text-[--brand]"
                >
                  Rename
                </button>
              </>
            )}
            {colourId === tag.id && (
              <div className="flex w-full items-center gap-1.5 pt-1">
                <label className="cursor-pointer" title="No colour">
                  <input
                    type="radio"
                    name={`colour-${tag.id}`}
                    checked={tag.colour === null}
                    onChange={() => saveColour(tag.id, null)}
                    disabled={pending}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className="block h-5 w-5 rounded-full border border-dashed border-black/25 bg-white opacity-60 peer-checked:opacity-100 peer-checked:ring-2 peer-checked:ring-brand peer-checked:ring-offset-1"
                  />
                  <span className="sr-only">No colour</span>
                </label>
                {TAG_COLOURS.map((c) => (
                  <label key={c.hex} className="cursor-pointer" title={c.name}>
                    <input
                      type="radio"
                      name={`colour-${tag.id}`}
                      checked={tag.colour === c.hex}
                      onChange={() => saveColour(tag.id, c.hex)}
                      disabled={pending}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      style={{ backgroundColor: c.hex }}
                      className="block h-5 w-5 rounded-full opacity-40 peer-checked:opacity-100 peer-checked:ring-2 peer-checked:ring-brand peer-checked:ring-offset-1"
                    />
                    <span className="sr-only">{c.name}</span>
                  </label>
                ))}
              </div>
            )}
            {errorByTagId[tag.id] && (
              <span className="w-full text-xs font-medium text-red-700" role="alert">
                {errorByTagId[tag.id]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
