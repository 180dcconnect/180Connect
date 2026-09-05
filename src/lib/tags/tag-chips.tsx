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

import { useState, useTransition } from "react";
import { X } from "lucide-react";

import { removeTagAction } from "@/lib/tags/tag-actions";
import { tagPillStyle } from "@/lib/tags/tag-colours";

export type TagChip = { id: string; name: string; colour?: string | null };

/** The V notch: 8px deep, apex centred on the right edge. */
const TAG_NOTCH_CLIP =
  "polygon(0 0, 100% 0, calc(100% - 8px) 50%, 100% 100%, 0 100%)";

export function TagChips({
  organisationId,
  tags,
  canEdit,
  onRemoved,
}: {
  organisationId: string;
  tags: TagChip[];
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
        // F194 AC2/AC4: a tag with a colour renders as a surface tinted with
        // it; absent/unrecognised falls back to today's brand styling.
        const pillStyle = tagPillStyle(tag.colour);
        return (
          <span key={tag.id} className="inline-flex items-center">
            <span
              style={{ clipPath: TAG_NOTCH_CLIP, ...(pillStyle ?? undefined) }}
              className={`inline-flex items-center py-1 pl-2.5 pr-3 text-xs font-medium ${
                pillStyle ? "" : "bg-brand/12 text-brand-hover"
              }`}
            >
              {tag.name}
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={() => handleRemove(tag.id)}
                disabled={pending}
                aria-label={`Remove ${tag.name}`}
                className="ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-dim opacity-60 transition-colors hover:bg-black/[0.06] hover:text-ink hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <X aria-hidden="true" className="size-3" strokeWidth={2.5} />
              </button>
            )}
          </span>
        );
      })}
      {errorTagId && (
        <span className="text-xs font-medium text-destructive" role="alert">
          Couldn&apos;t remove that tag. Try again.
        </span>
      )}
    </div>
  );
}