"use client";

// F192 — the tags assigned to this client, and removing one inline with no page
// reload. Assigning lives in `add-tag-popover.tsx`, and both are driven by the
// state in `tags-card.tsx` so a tag added in the picker appears here instantly.
//
// This used to also carry the assign UI: a native `<select>` of every tag plus
// an "+ Assign tag" button, sitting under the chips permanently. Both are gone.

import { TagChips } from "@/lib/tags/tag-chips";

export type ClientTag = { id: string; name: string; colour?: string | null };
export type AvailableTag = { id: string; name: string; colour?: string | null };

export function TagsSection({
  organisationId,
  clientTags,
  canEdit,
  onRemoved,
}: {
  organisationId: string;
  clientTags: ClientTag[];
  canEdit: boolean;
  onRemoved?: (tagId: string) => void;
}) {
  if (clientTags.length === 0) {
    return (
      <p className="mt-3 text-sm leading-[1.7] text-dim">No tags assigned yet.</p>
    );
  }

  return (
    <div className="mt-3">
      <TagChips
        organisationId={organisationId}
        tags={clientTags}
        canEdit={canEdit}
        onRemoved={onRemoved}
      />
    </div>
  );
}
