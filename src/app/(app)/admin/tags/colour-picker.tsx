"use client";

// The palette, as the tag you are about to get.
//
// A colour here used to be a 24px circle: eight dots and a dashed outline in a
// row, with the name of each one hidden in a `title` attribute and an `sr-only`
// span. You picked a colour by guessing what it would look like on a tag, and
// nothing on the screen ever showed you a tag.
//
// Now each choice *is* the tag — `TagChip`, the same notch-cut chip the client
// record draws, in that colour, with the colour's name written on it. The choice
// is still a real radio (`docs/app-design-system.md`: "pick-one choices are real
// radios"), it is just wearing the thing it produces, and the selected one is
// marked with a `--lead` ring on its seat rather than a dot in a row.

import { TagChip } from "@/lib/tags/tag-chips";
import { TAG_COLOURS } from "@/lib/tags/tag-colours";

const SEAT =
  "relative block cursor-pointer rounded-[10px] p-[3px] transition-shadow has-checked:ring-2 has-checked:ring-lead has-focus-visible:ring-2 has-focus-visible:ring-lead/40";

export function TagColourPicker({
  name,
  value,
  onChange,
  disabled = false,
  legend,
}: {
  /** The radio group's name — one group per tag being recoloured. */
  name: string;
  /** The chosen colour, or null for "no colour". */
  value: string | null;
  onChange: (colour: string | null) => void;
  disabled?: boolean;
  /**
   * The group's own label. A fieldset legend, so the browser announces it with
   * the group rather than leaving nine radios named Red, Amber, Green…
   */
  legend: string;
}) {
  const choices: { colour: string | null; label: string }[] = [
    { colour: null, label: "No colour" },
    ...TAG_COLOURS.map((colour) => ({ colour: colour.hex, label: colour.name })),
  ];

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" disabled={disabled}>
      <legend className="p-0 font-body text-[13px] font-medium text-dim">{legend}</legend>
      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {choices.map((choice) => (
          <label key={choice.colour ?? "none"} className={SEAT}>
            <input
              type="radio"
              name={name}
              value={choice.colour ?? ""}
              checked={value === choice.colour}
              onChange={() => onChange(choice.colour)}
              className="sr-only"
            />
            <TagChip label={choice.label} colour={choice.colour} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
