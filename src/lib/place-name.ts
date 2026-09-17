/**
 * One spelling for a place, so a council name and a client's city can be
 * compared.
 *
 * Outreach preferences now pick places from the Charity Commission's local
 * authority list (src/lib/charity-register/vocabulary.ts), whose names carry
 * the council's form — "Sheffield City", "City Of York", "Kingston Upon Hull
 * City" — while a client record holds a plain town or city ("Sheffield",
 * "York"). Compared raw, a CAM who picks Sheffield City would never see a
 * Sheffield client rise. This strips the council wrapper and lower-cases, and
 * is applied to *both* sides wherever preferred places meet client cities.
 *
 * Deliberately small: it removes "city of" / "city" only. It does not map a
 * borough to the towns inside it — ORGANISATIONS has no local-authority column
 * to match on, so "Kirklees" still only matches a client whose city is
 * literally Kirklees.
 */
export function normalisePlaceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^city of\s+/, "")
    .replace(/\s+city$/, "")
    .trim();
}

/**
 * The same place, written the way a client record writes it.
 *
 * `normalisePlaceName` above is for *comparing* — it lower-cases, so it cannot
 * be stored. This strips the same council wrapper and leaves the spelling
 * alone, so a picker built from the Charity Commission's authority list can
 * write "Sheffield" (what ORGANISATIONS.city holds everywhere today) rather
 * than "Sheffield City" (what the register calls the council). The two rules
 * are deliberately the same rule, so a place chosen from that list and a place
 * already on a record compare equal.
 */
export function displayPlaceName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^city of\s+/i, "")
    .replace(/\s+city$/i, "")
    .trim();
}
