/**
 * The vocabularies the companies import screen offers, in the register's own
 * terms where one exists.
 *
 * SIC descriptions are not here — they live in the file's sic_label table
 * (the register's wording, first-seen at build) and are read at runtime. What
 * is here: the 21 SIC2007 sections for grouping those codes, the company-type
 * slugs the build stores with friendly labels, and the normalised statuses.
 * None of these decide what gets imported; they only label the controls.
 *
 * Pure and node-testable: no database, no Supabase types, no React.
 */

/** The 21 sections of SIC2007, letter and official title. */
export const SIC_SECTIONS: ReadonlyArray<{ letter: string; title: string }> = [
  { letter: "A", title: "Agriculture, forestry and fishing" },
  { letter: "B", title: "Mining and quarrying" },
  { letter: "C", title: "Manufacturing" },
  { letter: "D", title: "Electricity, gas, steam and air conditioning supply" },
  { letter: "E", title: "Water supply, sewerage and waste management" },
  { letter: "F", title: "Construction" },
  { letter: "G", title: "Wholesale and retail trade" },
  { letter: "H", title: "Transportation and storage" },
  { letter: "I", title: "Accommodation and food service activities" },
  { letter: "J", title: "Information and communication" },
  { letter: "K", title: "Financial and insurance activities" },
  { letter: "L", title: "Real estate activities" },
  { letter: "M", title: "Professional, scientific and technical activities" },
  { letter: "N", title: "Administrative and support service activities" },
  { letter: "O", title: "Public administration and defence" },
  { letter: "P", title: "Education" },
  { letter: "Q", title: "Human health and social work activities" },
  { letter: "R", title: "Arts, entertainment and recreation" },
  { letter: "S", title: "Other service activities" },
  { letter: "T", title: "Activities of households as employers" },
  { letter: "U", title: "Activities of extraterritorial organisations" },
];

/**
 * A 5-digit SIC code's section, via its 2-digit division. Gaps in the
 * numbering (04, 34, 44 …) belong to no section and return null — a code the
 * standard never issued must not borrow a neighbour's meaning.
 */
export function sicSectionOf(sicCode: string): string | null {
  const division = Number(sicCode.slice(0, 2));
  if (!Number.isInteger(division) || sicCode.length !== 5) return null;
  if (division >= 1 && division <= 3) return "A";
  if (division >= 5 && division <= 9) return "B";
  if (division >= 10 && division <= 33) return "C";
  if (division === 35) return "D";
  if (division >= 36 && division <= 39) return "E";
  if (division >= 41 && division <= 43) return "F";
  if (division >= 45 && division <= 47) return "G";
  if (division >= 49 && division <= 53) return "H";
  if (division >= 55 && division <= 56) return "I";
  if (division >= 58 && division <= 63) return "J";
  if (division >= 64 && division <= 66) return "K";
  if (division === 68) return "L";
  if (division >= 69 && division <= 75) return "M";
  if (division >= 77 && division <= 82) return "N";
  if (division === 84) return "O";
  if (division === 85) return "P";
  if (division >= 86 && division <= 88) return "Q";
  if (division >= 90 && division <= 93) return "R";
  if (division >= 94 && division <= 96) return "S";
  if (division >= 97 && division <= 98) return "T";
  if (division === 99) return "U";
  return null;
}

/**
 * Every `cat_slug` the build stores, with the label the screen shows. The set
 * of slugs is derived from CATEGORY_TO_SLUG's values so a new file wording
 * with a new slug cannot silently miss its label — it falls back to a
 * title-cased slug, which reads plainly enough to report.
 */
export const COMPANY_TYPE_LABELS: Readonly<Record<string, string>> = {
  ltd: "Private limited company",
  "private-limited-guarant-nsc": "Private company limited by guarantee",
  "private-limited-guarant-nsc-limited-exemption": "Guarantee company (Limited exemption)",
  plc: "Public limited company",
  llp: "Limited liability partnership",
  "limited-partnership": "Limited partnership",
  "community-interest-company": "Community interest company",
  "charitable-incorporated-organisation": "Charitable incorporated organisation",
  "scottish-charitable-incorporated-organisation": "Scottish charitable incorporated organisation",
  "royal-charter": "Royal charter company",
  "united-kingdom-societas": "United Kingdom societas",
  "oversea-company": "Overseas entity",
  "registered-society-non-jurisdictional": "Registered society",
  "private-unlimited": "Private unlimited company",
  "private-unlimited-nsc": "Private unlimited company (no share capital)",
  "investment-company-with-variable-capital": "Investment company (variable capital)",
  "icvc-securities": "Investment company (securities)",
  "icvc-umbrella": "Investment company (umbrella)",
  "scottish-partnership": "Scottish partnership",
  "industrial-and-provident-society": "Industrial and provident society",
  eeig: "European economic interest grouping",
  "old-public-company": "Old public company",
  "private-limited-shares-section-30-exemption": "Private limited company (section 30)",
  "converted-or-closed": "Converted or closed",
  "protected-cell-company": "Protected cell company",
  other: "Other company type",
};

export function companyTypeLabel(slug: string): string {
  const known = COMPANY_TYPE_LABELS[slug];
  if (known) return known;
  return slug
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Every `status_norm` the build stores, with the label the screen shows. */
export const COMPANY_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "active", label: "Active" },
  { value: "liquidation", label: "Liquidation" },
  { value: "administration", label: "Administration" },
  { value: "voluntary-arrangement", label: "Voluntary arrangement" },
  { value: "receivership", label: "Receivership" },
  { value: "other", label: "Other" },
];

/** The statuses a fresh screen selects: live companies only. */
export const DEFAULT_STATUSES: ReadonlyArray<string> = ["active"];
