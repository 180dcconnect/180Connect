/**
 * Canonical mission resolution — one definition of "what this organisation does"
 * for every AI generation path.
 *
 * There are three mission-like columns and they are different claims:
 *
 * - `organisations.charity_activities`: the charity's own filed description
 *   (Charity Commission). Canonical register text, charities only.
 * - `organisations.cic_community_statement`: the CIC36 community-interest
 *   statement (Companies House filing, OCR-transcribed). Canonical register
 *   text, CICs only — the company-side equivalent of charity_activities.
 * - `enrichment_results.mission_statement`: hand-written (manual entry, URL
 *   import, admin edit — confidence 1) or LLM output. The enrichment worker
 *   that was meant to fill it has barely run, so it is empty for ~99% of rows.
 *
 * Priority is register-filed purpose first, human/LLM note second:
 * charity_activities → cic_community_statement → enrichment. A dual-registered
 * (`both`) row can hold both register texts; the Charity Commission purpose
 * wins because it describes activities, where the CIC statement describes the
 * community benefited.
 *
 * Deliberately never consulted: `sic_codes`. A SIC code is the registrar's
 * industry drawer (118 imported CICs share 85590), not a purpose statement —
 * presenting it as a mission is confidently wrong (see build-prompt.ts).
 *
 * Blank/whitespace counts as absent, matching annotateOrganisation's
 * convention, so "" can never read as a present value downstream.
 */

export type MissionSource =
  | "charity_activities"
  | "cic_statement"
  | "enrichment"
  | "none";

export type MissionInput = {
  charity_activities?: string | null;
  cic_community_statement?: string | null;
  enrichment_mission?: string | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Resolved mission text plus which column supplied it. */
export function resolveMission(input: MissionInput): {
  text: string | null;
  source: MissionSource;
} {
  const activities = clean(input.charity_activities);
  if (activities) return { text: activities, source: "charity_activities" };

  const cic = clean(input.cic_community_statement);
  if (cic) return { text: cic, source: "cic_statement" };

  const enrichment = clean(input.enrichment_mission);
  if (enrichment) return { text: enrichment, source: "enrichment" };

  return { text: null, source: "none" };
}

/** The text alone, for prompt contexts that only take a string. */
export function resolveMissionText(input: MissionInput): string | null {
  return resolveMission(input).text;
}
