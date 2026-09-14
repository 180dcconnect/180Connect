/**
 * Plain-English names for the data handling rules (F246 / F247).
 *
 * A rule is stored as a source, a path into an API response and a kind —
 * `companies_house` · `officers[*].date_of_birth` · `field_path`. That is the
 * right shape for the ingestion runner and the wrong one for the admin who keeps
 * the rules, who is not a developer (AGENTS.md, "Who will maintain this app").
 * This module is the translation, so no path or source code needs to appear on
 * /settings/data-handling-rules for any rule the platform ships with.
 *
 * Every rule seeded by the F246 and F247 migrations has an entry. A rule added
 * later through the developer form still works without one — it is shown by its
 * recorded reason — but should be given one here.
 */

export type RuleKind = "field_path" | "redact_personal_email" | "redact_phone_number";

export type SourceValue =
  | "companies_house"
  | "charitybase"
  | "charity_commission"
  | "360giving"
  | "find_that_charity"
  | "globalgiving"
  | "candid"
  | "website"
  | "charity_commission_bulk";

/**
 * Every value the `public.data_source_name` domain accepts
 * (20260923104000_add_charity_commission_bulk_data_source.sql). A source added to
 * the domain later needs a label here, or the developer form cannot offer it.
 */
export const SOURCE_LABELS: Record<SourceValue, string> = {
  companies_house: "Companies House",
  charitybase: "CharityBase",
  charity_commission: "Charity Commission",
  charity_commission_bulk: "Charity Commission register file",
  "360giving": "360Giving",
  find_that_charity: "Find That Charity",
  globalgiving: "GlobalGiving",
  candid: "Candid",
  website: "Charity websites",
};

export function sourceLabel(source: string | null): string {
  if (!source) return "Every source";
  return SOURCE_LABELS[source as SourceValue] ?? source.replaceAll("_", " ");
}

export type CatalogueEntry = {
  source: SourceValue | null;
  fieldPath: string;
  ruleKind: RuleKind;
  /** What is kept out, as a person would say it. */
  label: string;
  /** Why, in one sentence, without policy section numbers. */
  description: string;
  /** Recorded as the rule's reason when an admin turns this protection on. */
  reason: string;
};

export const RULE_CATALOGUE: readonly CatalogueEntry[] = [
  // Everyone, every source — special category data.
  {
    source: null, fieldPath: "health_data", ruleKind: "field_path",
    label: "Health information",
    description: "Special category data. The policy says we never collect it.",
    reason: "Special category data — the data handling policy says we never collect health information.",
  },
  {
    source: null, fieldPath: "ethnicity", ruleKind: "field_path",
    label: "Ethnicity",
    description: "Special category data. The policy says we never collect it.",
    reason: "Special category data — the data handling policy says we never collect ethnicity.",
  },
  {
    source: null, fieldPath: "religion", ruleKind: "field_path",
    label: "Religion",
    description: "Special category data. The policy says we never collect it.",
    reason: "Special category data — the data handling policy says we never collect religion.",
  },
  {
    source: null, fieldPath: "political_affiliation", ruleKind: "field_path",
    label: "Political views",
    description: "Special category data. The policy says we never collect it.",
    reason: "Special category data — the data handling policy says we never collect political views.",
  },
  {
    source: null, fieldPath: "sexual_orientation", ruleKind: "field_path",
    label: "Sexual orientation",
    description: "Special category data. The policy says we never collect it.",
    reason: "Special category data — the data handling policy says we never collect sexual orientation.",
  },
  {
    source: null, fieldPath: "*", ruleKind: "redact_personal_email",
    label: "Personal email addresses",
    description:
      "Blanked out wherever they appear, including inside website text. Shared inboxes such as info@ or fundraising@ are kept, because outreach needs them.",
    reason: "Personal email addresses must not be stored in any form. Shared role inboxes are kept.",
  },
  {
    source: null, fieldPath: "html", ruleKind: "redact_phone_number",
    label: "Phone numbers on charity websites",
    description:
      "Blanked out of website pages, where a number may be someone's mobile. Numbers from official registers are the organisation's switchboard and are kept.",
    reason: "A phone number on a web page may be a personal mobile; registry numbers are kept.",
  },

  // Companies House — company officers.
  {
    source: "companies_house", fieldPath: "officers[*].name", ruleKind: "field_path",
    label: "Company officers' names",
    description: "The company is the client, not the people who run it.",
    reason: "Officer names are personal data — the company is the client, not the person.",
  },
  {
    source: "companies_house", fieldPath: "officers[*].usual_residential_address", ruleKind: "field_path",
    label: "Company officers' home addresses",
    description: "Often a director's own home.",
    reason: "Officers' home addresses are personal data and are never stored.",
  },
  {
    source: "companies_house", fieldPath: "officers[*].address", ruleKind: "field_path",
    label: "Company officers' correspondence addresses",
    description: "Frequently the officer's home address.",
    reason: "Officers' correspondence addresses are frequently their home and are never stored.",
  },
  {
    source: "companies_house", fieldPath: "officers[*].date_of_birth", ruleKind: "field_path",
    label: "Company officers' dates of birth",
    description: "Personal data with no use for outreach.",
    reason: "Dates of birth are personal data with no outreach purpose.",
  },
  {
    source: "companies_house", fieldPath: "officers[*].nationality", ruleKind: "field_path",
    label: "Company officers' nationality",
    description: "Personal data with no use for outreach.",
    reason: "Nationality is personal data with no outreach purpose.",
  },
  {
    source: "companies_house", fieldPath: "officers[*].country_of_residence", ruleKind: "field_path",
    label: "Company officers' country of residence",
    description: "Personal data with no use for outreach.",
    reason: "Country of residence is personal data with no outreach purpose.",
  },
  {
    source: "companies_house", fieldPath: "officers[*].occupation", ruleKind: "field_path",
    label: "Company officers' occupations",
    description: "Personal detail about a named person, with no use for outreach.",
    reason: "Occupation is personal detail about a named individual with no outreach purpose.",
  },
  {
    source: "companies_house", fieldPath: "previous_company_names", ruleKind: "field_path",
    label: "Previous company names",
    description: "Not needed for outreach, and can include people's names.",
    reason: "Previous company names are not needed for outreach and may contain personal names.",
  },

  // Charity Commission — trustees.
  {
    source: "charity_commission", fieldPath: "trustees[*].trustee_name", ruleKind: "field_path",
    label: "Trustees' names",
    description: "The charity is the client, not its trustees.",
    reason: "Trustee names are personal data and are never stored.",
  },
  {
    source: "charity_commission", fieldPath: "trustees[*].name", ruleKind: "field_path",
    label: "Trustees' names (alternative format)",
    description: "Some Charity Commission records spell the trustee's name field differently.",
    reason: "Trustee names are personal data and are never stored.",
  },
  {
    source: "charity_commission", fieldPath: "trustees[*].home_address", ruleKind: "field_path",
    label: "Trustees' home addresses",
    description: "Personal data that is never stored.",
    reason: "Trustees' home addresses are personal data and are never stored.",
  },
  {
    source: "charity_commission", fieldPath: "trustees[*].date_of_birth", ruleKind: "field_path",
    label: "Trustees' dates of birth",
    description: "Personal data with no use for outreach.",
    reason: "Dates of birth are personal data with no outreach purpose.",
  },
  {
    source: "charity_commission", fieldPath: "trustees[*].other_names", ruleKind: "field_path",
    label: "Trustees' other names",
    description: "Aliases and former names — personal data with no use for outreach.",
    reason: "Trustees' other names are personal data with no outreach purpose.",
  },

  // CharityBase — trustees.
  {
    source: "charitybase", fieldPath: "trustees[*].name", ruleKind: "field_path",
    label: "Trustees' names",
    description: "The charity is the client, not its trustees.",
    reason: "Trustee names are personal data and are never stored.",
  },
  {
    source: "charitybase", fieldPath: "trustees[*].home_address", ruleKind: "field_path",
    label: "Trustees' home addresses",
    description: "Personal data that is never stored.",
    reason: "Trustees' home addresses are personal data and are never stored.",
  },
  {
    source: "charitybase", fieldPath: "trustees[*].date_of_birth", ruleKind: "field_path",
    label: "Trustees' dates of birth",
    description: "Personal data with no use for outreach.",
    reason: "Dates of birth are personal data with no outreach purpose.",
  },
  {
    source: "charitybase", fieldPath: "trustees[*].other_names", ruleKind: "field_path",
    label: "Trustees' other names",
    description: "Aliases and former names — personal data with no use for outreach.",
    reason: "Trustees' other names are personal data with no outreach purpose.",
  },

  // Find That Charity — trustees carried over from other registers.
  {
    source: "find_that_charity", fieldPath: "trustees[*].name", ruleKind: "field_path",
    label: "Trustees' names",
    description: "Find That Charity can carry trustee names over from other registers.",
    reason: "Trustee names are personal data and are never stored.",
  },
];

export function ruleKey(source: string | null, fieldPath: string, ruleKind: string): string {
  return `${source ?? "*"}|${fieldPath}|${ruleKind}`;
}

export function catalogueKey(entry: CatalogueEntry): string {
  return ruleKey(entry.source, entry.fieldPath, entry.ruleKind);
}

const BY_KEY = new Map(RULE_CATALOGUE.map((entry) => [catalogueKey(entry), entry]));

export function findCatalogueEntry(
  source: string | null,
  fieldPath: string,
  ruleKind: string = "field_path",
): CatalogueEntry | null {
  return BY_KEY.get(ruleKey(source, fieldPath, ruleKind)) ?? null;
}

function humanizeKey(key: string): string {
  const words = key
    .replace(/\[\*\]$/, "")
    // camelCase → separate words, then snake_case / kebab-case → spaces.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A readable name for any field path a source sends, for fields no one has
 * written a catalogue entry for: `recipientOrganization[*].addressLocality` →
 * "Recipient organization › Address locality". Mechanical, so it is shown next to
 * how often the field occurs rather than as a confident description.
 */
export function humanizeFieldPath(fieldPath: string): string {
  return fieldPath
    .split(".")
    .filter(Boolean)
    .map(humanizeKey)
    .join(" › ");
}

/** Whether a rule removes a field outright or blanks out matches inside text. */
export function ruleEffect(ruleKind: string): "removed" | "blanked" {
  return ruleKind === "field_path" ? "removed" : "blanked";
}

/**
 * Plain name for one entry of `raw_source_records.excluded_fields`, as returned by
 * `data_handling_filter_summary`: a bare path for a removed field, `path#kind` for
 * a blanked one. The summary carries no source, so any catalogue entry with the
 * same path and kind names it. Null when nothing in the catalogue matches.
 */
export function excludedFieldLabel(entry: string): string | null {
  const hash = entry.lastIndexOf("#");
  const fieldPath = hash === -1 ? entry : entry.slice(0, hash);
  const ruleKind = hash === -1 ? "field_path" : entry.slice(hash + 1);
  const match = RULE_CATALOGUE.find(
    (candidate) => candidate.fieldPath === fieldPath && candidate.ruleKind === ruleKind,
  );
  return match?.label ?? null;
}
