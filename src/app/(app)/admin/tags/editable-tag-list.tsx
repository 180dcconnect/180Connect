"use client";

// The team's tags: what each one is called, what it looks like, and how many
// clients carry it.
//
// F189 (rename, admin-only — enforced server-side regardless of what this UI
// shows), F194 (recolour, every CAM and admin — enforced by the `set_tag_colour`
// RPC) and F190 (delete, admin-only, blocked while the tag is in use — enforced
// by the `delete_unused_tag` RPC). Every write resolves without a page reload,
// and this component owns none of the state it shows: the panel above does, so
// the tag a CAM just created appears here at once (the record's `TagsCard` makes
// the same call for the same reason).
//
// ── What the old list could not say ──
//
// - **How much a decision costs.** It offered Rename and Delete on a tag used by
//   eleven clients, then refused after the click ("assigned to 11 clients"). The
//   count is read on the server and shown on the row now, and a tag that is on a
//   client offers no Delete button at all — a control whose only outcome is a
//   refusal is a bug report waiting to happen (`AGENTS.md` §Roles). Where the
//   count could not be read, deleting is withheld too, and the card says so:
//   an unknown count must never read as "safe to delete".
// - **Who may do what.** Every control is drawn only when the action behind it
//   would accept the reader: Rename and Delete ask `canRestructureTags` (an
//   administrator), changing a colour asks the `tags:manage` the recolour action
//   asks. Leadership reached this page and was offered "Change colour" anyway,
//   because that button alone was never gated — a control whose only possible
//   outcome is a refusal. A row can now offer them nothing at all, and the card
//   says why in one sentence rather than per row.
// - **What a tag looks like.** The row rendered a `rounded-full` pill with
//   brand-green text, so the tag on this screen did not match the tag on the
//   record. It is the record's chip now (`TagChip`), and the colour picker is
//   chips too, so you choose by looking at the result.

import { useTransition, useState } from "react";

import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { TagChip } from "@/lib/tags/tag-chips";
import { deleteTagAction } from "@/lib/tags/delete-tag-action.ts";
import { editTagAction } from "@/lib/tags/edit-tag-action";
import { setTagColourAction } from "@/lib/tags/set-tag-colour-action.ts";

import { TagColourPicker } from "./colour-picker";
import {
  PRIMARY_BUTTON,
  ROW_ACTION,
  ROW_ACTION_STOP,
  ROW_ERROR,
  SECONDARY_BUTTON,
  TEXT_FIELD,
} from "./styles";

export type TagEntry = { id: string; name: string; colour: string | null };

/**
 * How many clients carry each tag. `null` means the count could not be read —
 * which is not the same as zero, and is why the caller withholds deleting.
 */
export type TagUsage = Record<string, number | null>;

/** Said as what it is, and never as a number we did not read. */
function usageLabel(count: number | null): string {
  if (count === null) return "In use on clients — the count could not be read";
  if (count === 0) return "Not on any client yet";
  return count === 1 ? "On 1 client" : `On ${count} clients`;
}

export function EditableTagList({
  tags,
  usageById,
  canCreate,
  canRecolour,
  canRestructure,
  onRenamed,
  onRecoloured,
  onDeleted,
}: {
  tags: TagEntry[];
  usageById: TagUsage;
  /** Whether this reader may create one at all — the empty state says who can. */
  canCreate: boolean;
  /**
   * Whether this reader may choose a colour — the same `tags:manage` the
   * recolour action asks. Leadership reads this page and holds neither this nor
   * restructuring, so a row offers them no control at all, and the note below
   * stands where those controls would have been.
   */
  canRecolour: boolean;
  /** An administrator may rename and delete; a CAM may only recolour. */
  canRestructure: boolean;
  onRenamed: (tagId: string, name: string) => void;
  onRecoloured: (tagId: string, colour: string | null) => void;
  onDeleted: (tagId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // F194: the picker opens on one row at a time, under the tag it changes.
  const [colourId, setColourId] = useState<string | null>(null);
  // F190 AC1: deleting takes two steps. The first click asks, in words, on the
  // row itself — "Delete “Urgent”? Yes / Keep it" — rather than arming a button
  // that says "click again to confirm", which is a sentence about the mouse.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [errorByTagId, setErrorByTagId] = useState<Record<string, string>>({});

  function clearError(tagId: string) {
    setErrorByTagId((prev) => {
      if (!(tagId in prev)) return prev;
      const next = { ...prev };
      delete next[tagId];
      return next;
    });
  }

  function startEditing(tag: TagEntry) {
    setEditingId(tag.id);
    setDraftName(tag.name);
    setColourId(null);
    setConfirmingDeleteId(null);
    clearError(tag.id);
  }

  function saveEdit(tagId: string) {
    startTransition(async () => {
      const result = await editTagAction(tagId, draftName);
      if (result.ok) {
        onRenamed(tagId, result.tag.name);
        setEditingId(null);
      } else {
        setErrorByTagId((prev) => ({ ...prev, [tagId]: result.message }));
      }
    });
  }

  // F194 AC3: recolouring is open to every `tags:manage` holder, CAMs included,
  // and saves the moment a colour is picked — a colour is not worth a Save button.
  function saveColour(tagId: string, colour: string | null) {
    startTransition(async () => {
      try {
        const result = await setTagColourAction(tagId, colour);
        if (!result.ok) {
          setErrorByTagId((prev) => ({ ...prev, [tagId]: result.message }));
          return;
        }
        onRecoloured(tagId, result.tag.colour);
      } catch {
        setErrorByTagId((prev) => ({
          ...prev,
          [tagId]: "The colour could not be saved. Please try again.",
        }));
      }
    });
  }

  // F190: the second half of the two-step delete. The RPC still blocks an
  // in-use tag inside one transaction — somebody can assign the tag between
  // this row being drawn and this press — and its refusal names the count.
  function confirmDelete(tagId: string) {
    clearError(tagId);
    startTransition(async () => {
      const result = await deleteTagAction(tagId);
      if (result.ok) {
        onDeleted(tagId);
      } else {
        setErrorByTagId((prev) => ({ ...prev, [tagId]: result.message }));
      }
      setConfirmingDeleteId(null);
    });
  }

  if (tags.length === 0) {
    return (
      <p className="mt-3 font-body text-sm leading-[1.7] text-dim">
        {canCreate ? (
          <>
            No tags yet. Create the first one above, then put it on a client from
            that client&rsquo;s own record.
          </>
        ) : (
          <>
            No tags yet. A CAM or an administrator creates them on this screen,
            and any CAM can put one on a client from that client&rsquo;s own
            record.
          </>
        )}
      </p>
    );
  }

  // A count that failed is not a zero. If any row's count is unknown, the counts
  // on this page cannot be trusted, so no row offers a delete and the card says
  // why once rather than leaving a person to wonder at eleven identical gaps.
  const countsIncomplete = tags.some((tag) => usageById[tag.id] === null);

  return (
    <>
      {/* A reader who can change nothing gets the standard sentence once, where
          the row controls would have been, instead of nine silent rows. */}
      {!canRecolour && !canRestructure && (
        <p className="mt-3 font-body text-[13px] leading-[1.6] text-dim">
          {VIEW_ONLY_CONTROL_NOTE}
        </p>
      )}

      <ul className="mt-3 divide-y divide-rule-soft">
        {tags.map((tag) => {
          const usage = usageById[tag.id] ?? null;
          const editing = editingId === tag.id;
          const confirming = confirmingDeleteId === tag.id;
          const colouring = colourId === tag.id;

          return (
            <li key={tag.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {editing ? (
                  <form
                    className="flex flex-1 flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveEdit(tag.id);
                    }}
                  >
                    <label className="min-w-[14rem] flex-1">
                      <span className="sr-only">New name for {tag.name}</span>
                      <input
                        type="text"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        disabled={pending}
                        autoFocus
                        className={TEXT_FIELD}
                      />
                    </label>
                    <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
                      {pending ? "Saving…" : "Save name"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        clearError(tag.id);
                      }}
                      disabled={pending}
                      className={SECONDARY_BUTTON}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <TagChip label={tag.name} colour={tag.colour} />
                    <span className="font-body text-[13px] text-dim">
                      {usageLabel(usage)}
                    </span>

                    {canRestructure && !confirming && (
                      <button
                        type="button"
                        onClick={() => startEditing(tag)}
                        className={`ml-auto ${ROW_ACTION}`}
                      >
                        Rename
                      </button>
                    )}

                    {canRecolour && (
                      <button
                        type="button"
                        onClick={() => {
                          setColourId(colouring ? null : tag.id);
                          setConfirmingDeleteId(null);
                          clearError(tag.id);
                        }}
                        disabled={pending}
                        aria-expanded={colouring}
                        className={`${canRestructure && !confirming ? "" : "ml-auto"} ${ROW_ACTION}`}
                      >
                        {tag.colour === null ? "Add a colour" : "Change colour"}
                      </button>
                    )}

                    {canRestructure && !confirming && usage === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingDeleteId(tag.id);
                          setColourId(null);
                          clearError(tag.id);
                        }}
                        className={ROW_ACTION_STOP}
                      >
                        Delete
                      </button>
                    )}

                    {confirming && (
                      <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-body text-[13px] text-ink">
                          Delete “{tag.name}”?
                        </span>
                        <button
                          type="button"
                          onClick={() => confirmDelete(tag.id)}
                          disabled={pending}
                          className={ROW_ACTION_STOP}
                        >
                          {pending ? "Deleting…" : "Yes, delete"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          disabled={pending}
                          className={ROW_ACTION}
                        >
                          Keep it
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>

              {colouring && !editing && (
                <div className="mt-3 border-t border-rule-soft pt-3">
                  <TagColourPicker
                    name={`colour-${tag.id}`}
                    value={tag.colour}
                    onChange={(colour) => saveColour(tag.id, colour)}
                    disabled={pending}
                    legend={`What “${tag.name}” looks like on a client`}
                  />
                </div>
              )}

              {errorByTagId[tag.id] && (
                <p role="alert" className={`mt-2 ${ROW_ERROR}`}>
                  {errorByTagId[tag.id]}
                </p>
              )}

              {/* A tag that is on a client offers no Delete button at all; the
                  card's hint says why once, rather than the row repeating it. */}
            </li>
          );
        })}
      </ul>

      {countsIncomplete && canRestructure && (
        <p className="mt-3 font-body text-[13px] leading-[1.6] text-dim">
          How many clients carry a tag could not be read just now, so no tag can be
          deleted until it can. Refresh the page to try again.
        </p>
      )}
    </>
  );
}
