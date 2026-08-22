"use client";

// F191: assign an existing tag to this client, inline on the client
// profile page. Currently-assigned tags are shown read-only here —
// removing a tag is F192's own ticket/branch, kept out of this component
// deliberately so this PR stays scoped to F191 alone, matching this
// project's convention of one ticket/one reviewer per PR.

import { useState, useTransition } from "react";
import { assignTagAction } from "@/lib/tags/assign-tag-action";

export type ClientTag = { id: string; name: string };
export type AvailableTag = { id: string; name: string };

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

  return (
    <div className="mt-3">
      {clientTags.length === 0 ? (
        <p className="text-sm leading-[1.7] text-foreground/55">No tags assigned yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {clientTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center rounded-full bg-brand/12 px-2.5 py-1 text-xs font-medium text-brand-hover"
            >
              {tag.name}
            </span>
          ))}
        </div>
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
