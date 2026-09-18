// F194: Tag Colours — the shared palette and its validation.
//
// A fixed, curated palette rather than free-form hex: every entry is chosen
// to be readable as text on its own tint over the app's white/bone surfaces
// (all ≥ 4.5:1 against white), so a chip can never end up with unreadable
// contrast no matter who picks it. Free hex never enters the system — the
// validators below accept palette members only. The DB's CHECK constraint
// (20260829000000_tag_colour_check_and_set_colour_rpc.sql) enforces the looser
// hex-format invariant so the column can never hold non-colour text even if
// the palette evolves without a migration; membership is an application rule.

export type TagColour = {
  /** Lowercase #rrggbb, exactly as stored in TAGS.colour. */
  hex: string;
  name: string;
};

export const TAG_COLOURS: readonly TagColour[] = [
  { hex: "#b42318", name: "Red" },
  { hex: "#b54708", name: "Amber" },
  { hex: "#067647", name: "Green" },
  { hex: "#0e7090", name: "Teal" },
  { hex: "#175cd3", name: "Blue" },
  { hex: "#6938ef", name: "Violet" },
  { hex: "#c11574", name: "Pink" },
  { hex: "#344054", name: "Slate" },
] as const;

const HEXES_BY_VALUE = new Map(TAG_COLOURS.map((c) => [c.hex, c]));

/**
 * Parses user-supplied colour input into a storable TAGS.colour value.
 *
 * Absent ("", null, undefined) means "no colour chosen" → null, which the DB
 * column already allows and the UI renders as today's brand styling. Anything
 * that is not an exact palette member (wrong format, wrong case after
 * lowercasing, off-palette) returns null-with-invalid rather than a guess —
 * callers distinguish via `valid`.
 */
export function parseTagColour(raw: unknown): {
  valid: true; colour: string | null;
} | { valid: false; message: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { valid: true, colour: null };
  }
  if (typeof raw !== "string") {
    return { valid: false, message: "Pick a colour from the palette." };
  }
  const candidate = raw.trim().toLowerCase();
  if (!HEXES_BY_VALUE.has(candidate)) {
    return { valid: false, message: "Pick a colour from the palette." };
  }
  return { valid: true, colour: candidate };
}

/** True only for an exact palette member (the format the DB stores). */
export function isTagColour(value: unknown): value is string {
  return typeof value === "string" && HEXES_BY_VALUE.has(value.toLowerCase());
}

/**
 * Pill styling for a tag with a colour: a tint of the hue behind dark-hue
 * text (F194 AC2). The 1A alpha (~10%) keeps the bone/white surface visible
 * through it, matching how bg-brand/12 reads today. Returns null for absent
 * or unrecognised colours so callers fall back to the default brand pill —
 * a stale or hand-edited row degrades gracefully instead of breaking (AC4).
 */
export function tagPillStyle(
  colour: string | null | undefined,
): { backgroundColor: string; color: string } | null {
  if (!isTagColour(colour)) return null;
  return { backgroundColor: `${colour}1A`, color: colour };
}
