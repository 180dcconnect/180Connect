// What the bulk register import accepts, in one place.
//
// The Charity Commission's daily extract holds 185,574 registered charities
// (counted 2026-09-02). Almost none of them is a client 180DC Sheffield would
// ever approach, so the import is a **whitelist**: a charity enters the book
// only by matching every clause below. A bug that widens this filter imports
// tens of thousands of organisations nobody will contact, which is why the
// thresholds live here as data rather than inline in the streaming loop.
//
// Today's filter selects 4,704 charities. Anything wildly different from that
// after a change to this file is a reason to stop and look, not to proceed —
// the import script's --dry-run prints the count for exactly that check.

import { CLIENT_CRITERIA } from "../../client-criteria-config.ts";

/**
 * Below this, an engagement is not viable: a charity with under £100k of income
 * has no capacity to host a consulting project. It is also the boundary the
 * income_band enum already draws (100k_1m), so the filter and the scoring
 * bands agree rather than each having their own idea of "small".
 */
export const MIN_INCOME = 100_000;

/**
 * Charity Commission "What the charity does" classifications we accept, mapped
 * to the sector this project already scores by.
 *
 * The mapping is the point: `organisations.sector` is empty for every row in
 * the database today, so the SCOUT sector factor is neutral for the entire
 * book. A charity imported through here arrives already classified, by the
 * regulator, into the taxonomy in src/lib/scoring/score-by-sector.ts.
 *
 * The five accepted classifications are the ones whose sector scores above
 * neutral (Health & Wellbeing 0.7, Education & Youth 0.65, Poverty & Community
 * 0.6). Arts, heritage, environment and religion are excluded from *import*
 * rather than merely scored low — importing a client the scorer will always
 * rank last is filling the list with rows to scroll past.
 */
export const CLASSIFICATION_TO_SECTOR: Readonly<Record<string, string>> = {
  "The Advancement Of Health Or Saving Of Lives": "Health & Social Care",
  Disability: "Disability Support",
  "Education/training": "Education & Training",
  "The Prevention Or Relief Of Poverty": "Poverty Relief",
  "Economic/community Development/employment": "Community Development",
};

/** Local authorities the branch operates in, as the extract spells them. */
export const PRIORITY_LOCAL_AUTHORITIES: readonly string[] =
  CLIENT_CRITERIA.priorityCities;

/**
 * A charity is local if the register says it *operates* in one of the branch's
 * local authorities, or if its correspondence address sits in one of the
 * branch's postcode areas. Either is enough, deliberately: a Sheffield-based
 * charity that has not filled in its area of operation is still on our
 * doorstep, and a nationally-addressed charity that names Sheffield as an area
 * of operation is still working here.
 */
export const PRIORITY_POSTCODE_PREFIXES: readonly string[] =
  CLIENT_CRITERIA.priorityPostcodePrefixes;

/**
 * Postcode areas are letters-then-digits: "S1 2HE" is Sheffield, "SA1" is
 * Swansea. A naive `startsWith("S")` swallows every SA/SE/SK/SL/SM/SN/SO/SP/SR/
 * SS/ST/SW/SY postcode in the country — about a tenth of the register. The area
 * is the leading letters only, so it has to be compared as a whole token.
 */
export function postcodeArea(postcode: string | null | undefined): string {
  const compact = (postcode ?? "").toUpperCase().replace(/\s+/g, "");
  const match = /^([A-Z]{1,2})\d/.exec(compact);
  return match ? match[1] : "";
}

export function isPriorityPostcode(postcode: string | null | undefined): boolean {
  const area = postcodeArea(postcode);
  return area !== "" && PRIORITY_POSTCODE_PREFIXES.includes(area);
}

/** The extract files this import reads, and the order it reads them in. */
export const EXTRACT_BASE_URL =
  "https://ccewuksprdoneregsadata1.blob.core.windows.net/data/json";

export const EXTRACTS = {
  charity: "publicextract.charity",
  classification: "publicextract.charity_classification",
  areaOfOperation: "publicextract.charity_area_of_operation",
  annualReturnPartA: "publicextract.charity_annual_return_parta",
  annualReturnPartB: "publicextract.charity_annual_return_partb",
} as const;

export type ExtractName = keyof typeof EXTRACTS;
