"use client";

// The two halves of managing tags, in one client component — because they share
// one list.
//
// Creating a tag and reading the list are two cards, and the old screen rendered
// them as two independent components: the form held the result of its own submit
// and the list held its own copy of the tags, so a tag you had just created was
// nowhere on the page until a manual refresh. This owns the state and hands the
// callbacks down, which is the call the client record's `TagsCard` already makes
// for the same reason (`clients/[id]/tags-card.tsx`).
//
// The card's order is the old screen's: the form first, the list under it. The
// form is two fields and the list can be long, so the one thing a person comes
// here to do stays above the fold.

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

  const handleCreated = useCallback((tag: TagEntry) => {
    setTags((current) =>
      current.some((existing) => existing.id === tag.id)
        ? current
        : [...current, tag].sort(byName),
    );
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

  return (
    <Group className="space-y-6">
      {canCreate && (
        <Rise>
          <CreateTagForm existingNames={tags.map((tag) => tag.name)} onCreated={handleCreated} />
        </Rise>
      )}

      <Rise>
        <SectionCard
          headingId="tag-list-heading"
          title="The team’s tags"
          hint={listHint}
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
          />
        </SectionCard>
      </Rise>
    </Group>
  );
}
