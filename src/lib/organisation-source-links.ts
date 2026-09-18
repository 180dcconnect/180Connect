/**
 * "Check the source" — the public pages a client record's facts came from.
 *
 * Two admin screens answer a question about a record by sending the reader to
 * its origin: the incomplete-records queue ("is this sector right?") and the
 * approvals queue ("is the website being proposed the live one?"). Both offer
 * the same three readings, so the URL shapes live here once and
 * `@/components/check-the-source` renders the row.
 *
 * Pure and dependency-free, so it can be imported under plain `node --test` —
 * the same rule `organisation-format.ts` follows.
 */

/** One reading in the "Check the source" row. */
export type OrganisationSourceLink = { href: string; label: string };

/**
 * What the row needs to know about a client before it can offer anything.
 * Every field is optional: a record with no register number and no website
 * simply offers fewer links.
 */
export type OrganisationSource = {
  /** The Charity Commission registration number, from ORGANISATION_IDENTIFIERS. */
  charityNumber?: string | null;
  /** The Companies House company number, from the same table. */
  companyNumber?: string | null;
  /** ORGANISATIONS.website — the record's own site. */
  website?: string | null;
};

/**
 * The register's public page for a charity, or null when no number is recorded.
 *
 * Digits only: the register's detail path takes the number without its
 * punctuation, and numbers reach the record from the bulk register and manual
 * entry with spaces and dashes in them.
 */
export function charityRegisterHref(charityNumber: string | null | undefined): string | null {
  const digits = charityNumber?.replace(/\D/g, "") || null;
  return digits
    ? `https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/${digits}`
    : null;
}

/** The Companies House page for a company, or null when no number is recorded. */
export function companiesHouseHref(companyNumber: string | null | undefined): string | null {
  const number = companyNumber?.trim() || null;
  return number
    ? `https://find-and-update.company-information.service.gov.uk/company/${number}`
    : null;
}

/**
 * A website as a link to open. A record holds what its source published, which
 * is often a bare domain, so a missing scheme is added rather than leaving an
 * anchor that goes nowhere.
 */
export function websiteHref(website: string | null | undefined): string | null {
  const value = website?.trim() || null;
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/**
 * The row's links in the order it reads them: the registers first, because they
 * are the authority, then the organisation's own site.
 */
export function organisationSourceLinks(source: OrganisationSource): OrganisationSourceLink[] {
  const links: OrganisationSourceLink[] = [];

  const registerHref = charityRegisterHref(source.charityNumber);
  if (registerHref) links.push({ href: registerHref, label: "Charity Commission register" });

  const companiesHref = companiesHouseHref(source.companyNumber);
  if (companiesHref) links.push({ href: companiesHref, label: "Companies House" });

  const siteHref = websiteHref(source.website);
  if (siteHref) links.push({ href: siteHref, label: "Website" });

  return links;
}
