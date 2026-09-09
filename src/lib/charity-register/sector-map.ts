/**
 * The register's 17 "What the charity does" classifications, mapped onto the
 * sector taxonomy the scorer reads.
 *
 * Replaces the 5-entry CLASSIFICATION_TO_SECTOR in
 * charity-commission-bulk-config.ts, which was doing two jobs at once: deciding
 * which charities were allowed in *and* naming the sector for the ones that
 * were. Those are now separate. Selection is a filter the team sets on screen;
 * this map only answers "given that this charity is being imported, what does
 * the scorer call its sector".
 *
 * Because the two jobs were fused, a charity outside the five accepted
 * classifications could not be imported at all — and the map could never grow,
 * since adding an entry would silently widen the import. It can grow freely now.
 *
 * Four classifications map to null on purpose. "General Charitable Purposes"
 * (88,580 charities), "Other Charitable Purposes", "Religious Activities" and
 * "Armed Forces/emergency Service Efficiency" have no honest equivalent in the
 * six-category taxonomy, and inventing one would be worse than a null: the
 * scorer treats a missing sector as an explicit neutral default, whereas a wrong
 * sector silently moves a client's priority. A charity classified only as one of
 * those still imports; it simply arrives without a sector, exactly as every
 * charity did before this work.
 *
 * Values must be members of SECTOR_PRESETS in
 * src/app/settings/outreach-preferences/constants.ts — enforced by this module's
 * test, since lib must not import upwards from app/.
 */
export const CLASSIFICATION_SECTORS: Readonly<Record<string, string | null>> = {
  "The Advancement Of Health Or Saving Of Lives": "Health & Social Care",
  Disability: "Disability Support",
  "Education/training": "Education & Training",
  "The Prevention Or Relief Of Poverty": "Poverty Relief",
  "Economic/community Development/employment": "Community Development",
  "Arts/culture/heritage/science": "Arts & Culture",
  "Environment/conservation/heritage": "Environment & Conservation",
  "Accommodation/housing": "Housing & Homelessness",
  "Overseas Aid/famine Relief": "International Aid",
  "Human Rights/religious Or Racial Harmony/equality Or Diversity":
    "Human Rights & Justice",
  Animals: "Animal Welfare",
  "Amateur Sport": "Sports & Recreation",
  Recreation: "Sports & Recreation",

  // Deliberately unmapped — see the header.
  "General Charitable Purposes": null,
  "Other Charitable Purposes": null,
  "Religious Activities": null,
  "Armed Forces/emergency Service Efficiency": null,
};

/**
 * The sector for a charity, from the classifications the register gives it.
 *
 * A charity commonly carries several. The first mappable one in this map's
 * declaration order wins, because `sector` is a single column and the
 * alternative is a concatenation no scorer can match. Declaration order puts the
 * more specific causes first, so a charity classified as both "Disability" and
 * "General Charitable Purposes" is recorded as disability support rather than as
 * nothing.
 */
export function sectorForClassifications(
  classifications: readonly string[] | undefined,
): string | null {
  if (!classifications?.length) return null;
  for (const [classification, sector] of Object.entries(CLASSIFICATION_SECTORS)) {
    if (sector !== null && classifications.includes(classification)) return sector;
  }
  return null;
}
