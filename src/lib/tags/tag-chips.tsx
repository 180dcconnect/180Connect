"use client";

// F191/F192/F193 UI, following docs/design-system.md's "Inside the app"
// rules: bone/white app, rounded pills, --brand green as the single sparing
// accent (the doc names "an icon disc, a chip" as exactly where that accent
// belongs). Removal has no page reload (F192 AC2) — the chip disappears
// from local state the instant the server action confirms, no router
// navigation, no revalidation round-trip the person has to wait through.

import { useState, useTransition } from "react";
import { removeTagAction } from "@/lib/tags/tag-actions";

export type TagChip = { id: string; name: string };

export function TagChips({
  organisationId,
  tags,
  canEdit,
}: {
  organisationId: string;
  tags: TagChip[];
  canEdit: boolean;
}) {
  const [visibleTags, setVisibleTags] = useState(tags);
  const [pending, startTransition] = useTransition();
  const [errorTagId, setErrorTagId] = useState<string | null>(null);

  function handleRemove(tagId: string) {
    setErrorTagId(null);
    startTransition(async () => {
      const result = await removeTagAction(organisationId, tagId);
      if (result.ok) {
        // AC2: immediate, no reload — just drop it from local state.
        setVisibleTags((current) => current.filter((t) => t.id !== tagId));
      } else {
        setErrorTagId(tagId);
      }
    });
  }

  if (visibleTags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visibleTags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
        >
          {tag.name}
          {canEdit && (
            <button
              type="button"
              onClick={() => handleRemove(tag.id)}
              disabled={pending}
              aria-label={`Remove ${tag.name}`}
              className="ml-0.5 rounded-full text-brand/60 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {errorTagId && (
        <span className="text-xs font-medium text-red-700" role="alert">
          Couldn&apos;t remove that tag. Try again.
        </span>
      )}
    </div>
  );
}