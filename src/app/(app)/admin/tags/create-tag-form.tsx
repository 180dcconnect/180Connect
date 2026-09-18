"use client";

// F188/F194: create a tag, and pick what it looks like while you type.
//
// Rebuilt on the app's Filed Record language. What the old form could not say:
//
// - **What a tag is.** Two fields on a bare line under the heading, with the
//   palette as nine colourless dots. It never showed a tag, never said who may
//   use one, and never said that a name is shared across the whole team.
// - **What you are about to get.** The card now draws the tag — the same
//   notch-cut chip the client record draws — and redraws it as you type and as
//   you pick a colour.
// - **That the name is taken.** Tag names are unique per team, case-insensitively
//   (the DB's `lower(name)` index), and the old form only found out on submit
//   ("A tag named "Urgent" already exists."). The names are already here — this
//   card is rendered by the panel that holds the list — so it says so as you
//   type and disables the button. The server still refuses it in a race; this
//   only stops the pointless round trip.
//
// The palette is `TagColourPicker`, shared with the list below, because the
// colour you choose here and the colour you change later must be the same
// control or they will drift.

import { useActionState, useEffect, useRef, useState } from "react";

import { SectionCard } from "@/app/(app)/clients/[id]/section-card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { TagChip } from "@/lib/tags/tag-chips";
import type { CreateTagResult } from "@/lib/tags/create-tag-core";

import { TagColourPicker } from "./colour-picker";
import { PRIMARY_BUTTON, SECONDARY_BUTTON, TEXT_FIELD } from "./styles";
import { createTagFormAction } from "./tags-actions";
import type { TagEntry } from "./editable-tag-list";

export function CreateTagForm({
  existingNames,
  onCreated,
  onCancel,
}: {
  /** Every tag name already in use, to answer "is this name taken?" as you type. */
  existingNames: string[];
  /** Hands the new tag to the panel, so it appears in the list below at once. */
  onCreated: (tag: TagEntry) => void;
  /** Optional callback to close or cancel creating a tag. */
  onCancel?: () => void;
}) {
  const [state, action, pending] = useActionState<CreateTagResult | null, FormData>(
    createTagFormAction,
    null,
  );
  const [name, setName] = useState("");
  const [colour, setColour] = useState<string | null>(null);

  // The tag reached the list exactly once per successful submission. `state` is a
  // fresh object per completed action, so its identity is the record that this
  // particular result has been handed on — which survives the parent re-rendering
  // (and re-creating its callback) while the field keeps its value.
  const handedOn = useRef<CreateTagResult | null>(null);
  useEffect(() => {
    if (!state?.ok || handedOn.current === state) return;
    handedOn.current = state;
    onCreated(state.tag);
    setName("");
    setColour(null);
  }, [state, onCreated]);

  const trimmed = name.trim();
  const taken =
    trimmed.length > 0 &&
    existingNames.some((existing) => existing.trim().toLowerCase() === trimmed.toLowerCase());

  // No hint on this card: the page says what a tag is, once, above both cards.
  // This card's own job is to show you the tag you are about to make.
  return (
    <SectionCard
      headingId="create-tag-heading"
      title="Create a tag"
      action={
        onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer font-body text-xs font-semibold text-dim hover:text-ink transition-colors"
          >
            Cancel
          </button>
        ) : null
      }
    >
      <form action={action} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
            <span className="font-body text-[13px] font-medium text-dim">
              What should the tag be called?
            </span>
            <input
              type="text"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Urgent"
              disabled={pending}
              autoComplete="off"
              className={TEXT_FIELD}
            />
          </label>
          <div className="flex flex-col items-start gap-1.5">
            <span className="font-body text-[13px] font-medium text-dim">
              What it will look like on a client
            </span>
            <div className="flex h-10 items-center">
              <TagChip label={trimmed === "" ? "New tag" : trimmed} colour={colour} />
            </div>
          </div>
        </div>

        <TagColourPicker
          name="colour"
          value={colour}
          onChange={setColour}
          disabled={pending}
          legend="Which colour?"
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="submit" disabled={pending || taken} className={PRIMARY_BUTTON}>
            {pending ? "Creating…" : "Create tag"}
          </button>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className={SECONDARY_BUTTON}
            >
              Cancel
            </button>
          )}

          {/*
            The two messages below are this screen's own, not `InlineAlert`s:
            its `success` tone is brand green (`--brand`, 2.3:1) and its
            `warning` tone is Tailwind's amber, and neither is an app colour
            (`docs/app-design-system.md` §Colour). A failure still goes through
            the house component, because that one *is* the app's own.
          */}
          {taken && (
            <p role="status" className="font-body text-[13px] text-hold">
              “{trimmed}” is already a tag. Pick another name, or change the tag that exists.
            </p>
          )}

          {state?.ok && (
            <p role="status" className="font-body text-[13px] text-go">
              Added. “{state.tag.name}” is on the list below.
            </p>
          )}

          {state && !state.ok && (
            <InlineAlert variant="inline" message={state.message} />
          )}
        </div>
      </form>
    </SectionCard>
  );
}
