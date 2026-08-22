/**
 * Mirrors public.geographic_reach and public.income_band
 * (supabase/migrations/20260722103100_create_organisations.sql,
 * 20260804180000_create_org_children.sql). Kept as a literal list rather than read
 * from the database, same as ROLES in src/lib/auth/permissions.ts — these are
 * schema enums, not data, and changing one is a migration either way.
 */
export const GEOGRAPHIC_REACH_OPTIONS = [
  "local",
  "regional",
  "national",
  "international",
] as const;

export type GeographicReach = (typeof GEOGRAPHIC_REACH_OPTIONS)[number];

export const GEOGRAPHIC_REACH_LABELS: Record<GeographicReach, string> = {
  local: "Local",
  regional: "Regional",
  national: "National",
  international: "International",
};

export const INCOME_BAND_OPTIONS = [
  "under_10k",
  "10k_100k",
  "100k_1m",
  "over_1m",
] as const;

export type IncomeBand = (typeof INCOME_BAND_OPTIONS)[number];

export const INCOME_BAND_LABELS: Record<IncomeBand, string> = {
  under_10k: "Under £10k",
  "10k_100k": "£10k – £100k",
  "100k_1m": "£100k – £1m",
  over_1m: "Over £1m",
};

// ORGANISATIONS.sector has no enum yet (LLM-classified free text, F089/F041/F055 not
// built — see docs/data-model/04-entities.md), so sector preference is free text
// rather than a checkbox list. This cap just keeps a single tag reasonable; it is not
// trying to anticipate a future canonical list.
export const MAX_SECTOR_LENGTH = 60;
export const MAX_SECTORS = 20;

// F197: Standard sector taxonomy synthesised from Charity Commission causes/themes,
// Companies House SIC industry codes, and 180DC non-profit consulting focus areas.
export const SECTOR_CATEGORY_GROUPS = [
  {
    category: "Health & Wellbeing",
    presets: [
      "Health & Social Care",
      "Mental Health",
      "Disability Support",
      "Medical Research",
    ],
  },
  {
    category: "Education & Youth",
    presets: [
      "Education & Training",
      "Youth & Children",
      "Schools & Colleges",
      "Skills & Employment",
    ],
  },
  {
    category: "Environment & Sustainability",
    presets: [
      "Environment & Conservation",
      "Climate & Sustainability",
      "Renewable Energy",
      "Animal Welfare",
    ],
  },
  {
    category: "Poverty & Community",
    presets: [
      "Poverty Relief",
      "Housing & Homelessness",
      "Community Development",
      "Social Inclusion",
    ],
  },
  {
    category: "Arts, Culture & Heritage",
    presets: [
      "Arts & Culture",
      "Heritage & Museums",
      "Sports & Recreation",
    ],
  },
  {
    category: "Social Justice & Enterprise",
    presets: [
      "Social Enterprise",
      "International Aid",
      "Human Rights & Justice",
    ],
  },
] as const;

export const SECTOR_PRESETS = SECTOR_CATEGORY_GROUPS.flatMap((g) => g.presets);

// F196: City and location presets for fast selection, plus caps to ensure
// sensible bounds for custom-typed locations.
export const CITY_PRESETS = [
  "Sheffield",
  "South Yorkshire",
  "Rotherham",
  "Barnsley",
  "Doncaster",
  "Leeds",
  "Manchester",
  "London",
] as const;

export const MAX_CITY_LENGTH = 60;
export const MAX_CITIES = 20;


