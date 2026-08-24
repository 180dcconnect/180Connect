"use client";

// F191/F192: assign an existing tag to this client inline on the client
// profile page, and remove an assigned tag via TagChips (F192) — no page
// reload for either. This component owns the assigned-tags state so assign
// and remove stay in sync with each other.

import { useState, useTransition } from "react";
import { assignTagAction } from "@/lib/tags/assign-tag-action";
import { TagChips } from "@/lib/tags/tag-chips";

export type ClientTag = { id: string; name: string; colour?: string | null };
export type AvailableTag = { id: string; name: string; colour?: string | null };

export function TagsSection({
  organisationId,
  initialClientTags,
  availableTags,
  canEdit,
}: {
  organisationId: string;
  initialClientTags: ClientTag[];
  availableTags: AvailableTag[];
  canEdit: boolean;
}) {
  const [clientTags, setClientTags] = useState(initialClientTags);
  const [selectedTagId, setSelectedTagId] = useState(availableTags[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const assignableTags = availableTags.filter(
    (tag) => !clientTags.some((ct) => ct.id === tag.id),
  );

  function handleAssign() {
    if (!selectedTagId) return;
    setError(null);
    startTransition(async () => {
      const result = await assignTagAction(organisationId, selectedTagId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.result.failed.length > 0) {
        setError(result.result.failed[0].message);
        return;
      }
      const tag = availableTags.find((t) => t.id === selectedTagId);
      if (tag) setClientTags((current) => [...current, tag]);
    });
  }

  function handleRemoved(tagId: string) {
    setClientTags((current) => current.filter((t) => t.id !== tagId));
  }

  return (
    <div className="mt-3">
      {clientTags.length === 0 ? (
        <p className="text-sm leading-[1.7] text-foreground/55">No tags assigned yet.</p>
      ) : (
        <TagChips
          organisationId={organisationId}
          tags={clientTags}
          canEdit={canEdit}
          onRemoved={handleRemoved}
        />
      )}

      {canEdit && assignableTags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={selectedTagId}
            onChange={(e) => setSelectedTagId(e.target.value)}
            disabled={pending}
            className="rounded-full border border-black/[0.08] px-3 py-1.5 text-xs"
          >
            {assignableTags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAssign}
            disabled={pending}
            className="rounded-full bg-brand/12 px-3 py-1.5 text-xs font-bold text-brand-hover hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Assigning…" : "+ Assign tag"}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
