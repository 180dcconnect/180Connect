"use client";

// F192 UI for Remove Tag from Client, following docs/design-system.md's
// "Inside the app" rules: bone/white app, rounded pills, --brand green as
// the single sparing accent (the doc names "an icon disc, a chip" as exactly
// where that accent belongs). Removal has no page reload (F192 AC2): the
// server action confirms, then the parent drops the tag from its state.
// The list itself lives in the parent (TagsSection on the client profile),
// so chips assigned elsewhere in the same session stay in sync.

import { useState, useTransition } from "react";
import { removeTagAction } from "@/lib/tags/tag-actions";

export type TagChip = { id: string; name: string };

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
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-full bg-brand/12 px-2.5 py-1 text-xs font-medium text-brand-hover"
        >
          {tag.name}
          {canEdit && (
            <button
              type="button"
              onClick={() => handleRemove(tag.id)}
              disabled={pending}
              aria-label={`Remove ${tag.name}`}
              className="ml-0.5 rounded-full text-brand-hover/60 hover:text-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {errorTagId && (
        <span className="text-xs font-medium text-destructive" role="alert">
          Couldn&apos;t remove that tag. Try again.
        </span>
      )}
    </div>
  );
}
