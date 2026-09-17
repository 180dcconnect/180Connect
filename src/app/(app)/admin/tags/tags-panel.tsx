"use client";

// The two halves of managing tags, in one client component — because they share
// one list.
//
// Creating a tag and reading the list are two cards. By default, the list of
// tags is shown, with a "+ Create a tag" action button in the section header.
// Touching the button reveals the CreateTagForm. Submitting or cancelling
// closes the form and returns to the clean list view.

import { useCallback, useState } from "react";

import { SectionCard } from "@/app/(app)/clients/[id]/section-card";
import { Group, Rise } from "@/components/dashboard-stage";

import { CreateTagForm } from "./create-tag-form";
import { EditableTagList, type TagEntry, type TagUsage } from "./editable-tag-list";

function byName(a: TagEntry, b: TagEntry): number {
  return a.name.localeCompare(b.name);
}

export function TagsPanel({
  initialTags,
  usageById,
  canCreate,
  canRecolour,
  canRestructure,
}: {
  initialTags: TagEntry[];
  usageById: TagUsage;
  /** A CAM or an admin may create a tag (`tags:manage`); a viewer may not. */
  canCreate: boolean;
  /** Whether this reader may choose a tag's colour — the same `tags:manage`. */
  canRecolour: boolean;
  /** Only an administrator may rename or delete one (`canRestructureTags`). */
  canRestructure: boolean;
}) {
  const [tags, setTags] = useState(initialTags);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreated = useCallback((tag: TagEntry) => {
    setTags((current) =>
      current.some((existing) => existing.id === tag.id)
        ? current
        : [...current, tag].sort(byName),
    );
    setIsCreating(false);
  }, []);

  const handleRenamed = useCallback((tagId: string, name: string) => {
    setTags((current) =>
      current
        .map((tag) => (tag.id === tagId ? { ...tag, name } : tag))
        .sort(byName),
    );
  }, []);

  const handleRecoloured = useCallback((tagId: string, colour: string | null) => {
    setTags((current) =>
      current.map((tag) => (tag.id === tagId ? { ...tag, colour } : tag)),
    );
  }, []);

  const handleDeleted = useCallback((tagId: string) => {
    setTags((current) => current.filter((tag) => tag.id !== tagId));
  }, []);

  // What each control on the list is for, in the words of the job, depending on
  // who is reading. A CAM may create and recolour; renaming or deleting a shared
  // tag changes it on every client carrying it, so that is an administrator's
  // job — and the screen says so rather than offering a button that refuses.
  const listHint = canRestructure
    ? "Each tag shows how many clients carry it. Renaming or deleting a tag changes it on every client that already has it, and a tag on a client has to be taken off those clients before it can be deleted."
    : canRecolour
      ? "Each tag shows how many clients carry it. Creating a tag and changing its colour are yours to do; renaming or deleting one changes it on every client that already has it, so an administrator does that."
      : "Each tag shows how many clients carry it. Any CAM can put one on a client, and the client list can be filtered by it.";

  const createAction = canCreate ? (
    <button
      type="button"
      onClick={() => setIsCreating((prev) => !prev)}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-3 py-1.5 text-xs font-semibold text-paper transition-colors hover:bg-lead-mid"
    >
      <span aria-hidden="true">{isCreating ? "×" : "+"}</span>
      <span>{isCreating ? "Cancel" : "Create a tag"}</span>
    </button>
  ) : null;

  return (
    <Group className="space-y-6">
      {canCreate && isCreating && (
        <Rise>
          <CreateTagForm
            existingNames={tags.map((tag) => tag.name)}
            onCreated={handleCreated}
            onCancel={() => setIsCreating(false)}
          />
        </Rise>
      )}

      <Rise>
        <SectionCard
          headingId="tag-list-heading"
          title="The team’s tags"
          hint={listHint}
          action={createAction}
        >
          <EditableTagList
            tags={tags}
            usageById={usageById}
            canCreate={canCreate}
            canRecolour={canRecolour}
            canRestructure={canRestructure}
            onRenamed={handleRenamed}
            onRecoloured={handleRecoloured}
            onDeleted={handleDeleted}
            onCreateClick={() => setIsCreating(true)}
          />
        </SectionCard>
      </Rise>
    </Group>
  );
}
