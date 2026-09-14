import type { GeographicReach } from "./types.ts";

/**
 * The declared operating areas the reach ladder reads. A structural subset of
 * `CharityOperatingAreas` (charity-register/sqlite.ts) on purpose: this module
 * is pure and unit-tested, and importing the register reader would pull its
 * `server-only` filesystem dependency into the decision logic.
 */
export type DeclaredOperatingAreas = {
  localAuthorities: readonly string[];
  regions: readonly string[];
  countries: readonly string[];
};

/**
 * Derives an organisation's geographic reach from its declared areas of
 * operation — the Charity Commission annual-return areas, not the import
 * filter that found the charity.
 *
 * The ladder is deliberately conservative: it never claims a wider reach than
 * the charity declared. A charity working across thirty local authorities
 * without declaring a region reads as regional, not national — understating is
 * a prompt line missing context, overstating is the product asserting
 * something the register does not say.
 *
 *   - any declared country (all 275 in the file are outside the UK) → international
 *   - any declared region (the file's four are the UK's nations) → national
 *   - two or more local authorities → regional
 *   - exactly one local authority → local
 *   - nothing declared, or no areas to read → null, not a guess
 *
 * Pure — no I/O. The register read happens in the promote layer
 * (write-organisations.ts), which passes what the file holds.
 */
export function deriveGeographicReach(
  areas: DeclaredOperatingAreas | null | undefined,
): GeographicReach | null {
  if (!areas) return null;
  if (areas.countries.length > 0) return "international";
  if (areas.regions.length > 0) return "national";
  if (areas.localAuthorities.length >= 2) return "regional";
  if (areas.localAuthorities.length === 1) return "local";
  return null;
}
