/**
 * UK postcode *area* matching — the branch-locality test, in one place.
 *
 * Lived in charity-commission-bulk-config.ts while the legacy bulk import was
 * its only caller. It is shared now because more than one place needs to agree
 * about what a postcode *area* is: the import filter builder normalises what
 * someone types into one, and `checkClientCriteria` tests the same prefixes on
 * the way into the client list. A second copy of this rule is the last thing
 * they should have — the failure mode when two copies disagree is silent.
 *
 * Independent of `checkClientCriteria`, which applies the same prefixes to an
 * already-standardised organisation (city OR postcode, plus type and mission).
 * This module answers a narrower question — is this raw postcode in one of the
 * branch's areas — at a point in the pipeline where nothing has been
 * standardised yet.
 */

import { CLIENT_CRITERIA } from "./client-criteria-config.ts";

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

/** Whether a postcode sits in one of the branch's postcode areas (S, DN). */
export function isPriorityPostcode(postcode: string | null | undefined): boolean {
  const area = postcodeArea(postcode);
  return area !== "" && CLIENT_CRITERIA.priorityPostcodePrefixes.includes(area);
}
