"use client";

import { useState } from "react";
import { Tag } from "lucide-react";

import { MAX_TAGS_PER_CLIENT } from "@/lib/tags/assign-tag-core";
import { AddTagPopover } from "./add-tag-popover";
import { SectionCard } from "./section-card";
import { TagsSection, type AvailableTag, type ClientTag } from "./tags-section";

/**
 * F191/F192 — the Tags card, whole.
 *
 * It exists because the two halves of tagging have to share one piece of state.
 * The page used to render `TagsSection` **twice** — once in the card's heading
 * `action` slot with `compact`, once in its body with `hideAssign` — which meant
 * two independent `useState` copies of the same tag list: assigning a tag in the
 * header updated the header's copy, and the chips below it did not move until a
 * refresh. Owning the list here and passing it down fixes that by construction,
 * and the `compact`/`hideAssign`/`hideEmptyState` prop switches disappear with
 * it.
 *
 * `z-40` while the picker is open: each card sits inside its own `Rise`, a
 * `motion.div` whose entrance animates `filter`, and a filtered element opens a
 * stacking context. Without lifting this one, the popover — `z-50` *within* the
 * card — would still paint under the card that follows it in the column.
 */
export function TagsCard({
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
  const [allAvailableTags, setAllAvailableTags] = useState(availableTags);
  const [pickerOpen, setPickerOpen] = useState(false);

  const assignedTagIds = new Set(clientTags.map((tag) => tag.id));
  const assignableTags = allAvailableTags.filter((tag) => !assignedTagIds.has(tag.id));

  return (
    <SectionCard
      headingId="tags-heading"
      title="Tags"
      icon={<Tag />}
      className={pickerOpen ? "relative z-40" : ""}
      action={
        canEdit ? (
          clientTags.length >= MAX_TAGS_PER_CLIENT ? (
            /* At the per-client cap there is nothing to add, so the picker is
                not offered — a count the removal buttons beside each tag can
                bring back under the limit. */
            <span className="text-xs font-semibold text-faint">
              {MAX_TAGS_PER_CLIENT} of {MAX_TAGS_PER_CLIENT} tags used
            </span>
          ) : (
            <AddTagPopover
              organisationId={organisationId}
              assignableTags={assignableTags}
              assignedTags={clientTags}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onTagCreated={(newTag) =>
                setAllAvailableTags((current) =>
                  current.some((t) => t.id === newTag.id) ? current : [...current, newTag],
                )
              }
              onBatchAssigned={(tags: AvailableTag[]) =>
                setClientTags((current) => {
                  const existingIds = new Set(current.map((t: ClientTag) => t.id));
                  const newOnes = tags.filter((t: AvailableTag) => !existingIds.has(t.id));
                  return [...current, ...newOnes];
                })
              }
            />
          )
        ) : null
      }
    >
      <TagsSection
        organisationId={organisationId}
        clientTags={clientTags}
        canEdit={canEdit}
        onRemoved={(tagId) =>
          setClientTags((current) => current.filter((tag) => tag.id !== tagId))
        }
      />
    </SectionCard>
  );
}
