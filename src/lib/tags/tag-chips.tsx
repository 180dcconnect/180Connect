"use client";

// F192 UI for Remove Tag from Client. Removal has no page reload (F192 AC2):
// the server action confirms, then the parent drops the tag from its state.
// The list itself lives in the parent (TagsSection on the client profile),
// so chips assigned elsewhere in the same session stay in sync.
//
// The shape is a tag, not a pill: a rectangle cut with a V notch into its
// right edge, like the punch-hole end of a paper tag. The clip-path carves
// the notch out of the tinted surface; the delete button sits in the empty
// space the notch leaves beside the tag, so removal reads as an affordance
// next to the tag rather than a glyph printed on it.
//
// ── One chip, everywhere (Sept 2026) ──
//
// `TagChip` is the tag as it appears wherever a tag appears: the client
// record's card, the tags screen's list and its colour picker. Before it there
// were two renderings of the same data and they disagreed — the record drew a
// notched chip in the tag's colour, the admin list drew a `rounded-full` pill,
// and a tag with *no* colour came out brand-green on one screen and a second,
// different brand tint on the other.
//
// **No colour is neutral now**: `bg-paper-sunk text-ink`, the app's own neutral
// fill (`docs/app-design-system.md` §Surfaces). A tag is the one thing a person
// genuinely chooses the colour of, which is exactly why "I chose nothing" must
// not silently arrive as 180DC green — a green chip on a record reads as a
// status, and `--brand` is not an app colour at all. The `/clients` filter bar
// already treated an uncoloured tag as neutral; this makes the chip agree with
// it.

import { useState, useTransition } from "react";
import { X } from "lucide-react";

import { removeTagAction } from "@/lib/tags/tag-actions";
import { tagPillStyle } from "@/lib/tags/tag-colours";

/** A tag, as the chips need it. Named apart from the `TagChip` component below. */
export type TagChipData = { id: string; name: string; colour?: string | null };

/** The V notch: 8px deep, apex centred on the right edge. */
export const TAG_NOTCH_CLIP =
  "polygon(0 0, 100% 0, calc(100% - 8px) 50%, 100% 100%, 0 100%)";

/**
 * A tag with no colour (or one we no longer recognise): the neutral pill. F194
 * AC4's graceful degradation, on the system's neutral rather than a brand tint.
 */
export const TAG_CHIP_NEUTRAL = "bg-paper-sunk text-ink";

/**
 * The read-only tag: the notched chip, tinted with the tag's own colour where
 * it has one. Nothing here is interactive — the remove button is `TagChips`'
 * job, and a picker wraps this in its own radio.
 */
export function TagChip({
  label,
  colour,
  className = "",
}: {
  label: string;
  colour?: string | null;
  className?: string;
}) {
  const tint = tagPillStyle(colour);
  return (
    <span
      style={{ clipPath: TAG_NOTCH_CLIP, ...(tint ?? undefined) }}
      className={`inline-flex items-center py-1 pr-3 pl-2.5 font-body text-xs font-medium ${
        tint ? "" : TAG_CHIP_NEUTRAL
      } ${className}`}
    >
      {label}
    </span>
  );
}

export function TagChips({
  organisationId,
  tags,
  canEdit,
  onRemoved,
}: {
  organisationId: string;
  tags: TagChipData[];
  canEdit: boolean;
  onRemoved?: (tagId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [errorTagId, setErrorTagId] = useState<string | null>(null);

  function handleRemove(tagId: string) {
    setErrorTagId(null);
    startTransition(async () => {
      // The action normally resolves with { ok: false } for a refusal, but
      // an unexpected throw (network drop, auth expiry mid-request) must
      // land in the same safe failure message, not vanish as an unhandled
      // rejection inside the transition.
      try {
        const result = await removeTagAction(organisationId, tagId);
        if (!result.ok) {
          setErrorTagId(tagId);
          return;
        }
      } catch {
        setErrorTagId(tagId);
        return;
      }
      onRemoved?.(tagId);
    });
  }

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => {
        return (
          <span key={tag.id} className="inline-flex items-center">
            <TagChip label={tag.name} colour={tag.colour} />
            {canEdit && (
              <button
                type="button"
                onClick={() => handleRemove(tag.id)}
                disabled={pending}
                aria-label={`Remove ${tag.name}`}
                className="ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-dim opacity-60 transition-colors hover:bg-paper-sunk hover:text-ink hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead disabled:cursor-not-allowed disabled:opacity-30"
              >
                <X aria-hidden="true" className="size-3" strokeWidth={2.5} />
              </button>
            )}
          </span>
        );
      })}
      {errorTagId && (
        <span className="font-body text-[13px] text-stop" role="alert">
          Couldn&apos;t remove that tag. Try again.
        </span>
      )}
    </div>
  );
}