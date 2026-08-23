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

/**
 * The income-band values and deriveIncomeBand moved to
 * src/lib/income-band.ts so lib-side consumers (F091 size scoring,
 * visible-clients queue ordering) can share them without importing out of
 * src/app; re-exported here to keep this module's public surface stable.
 * Mirrors public.income_band
 * (supabase/migrations/20260804180000_create_org_children.sql), same
 * approach as ROLES in src/lib/auth/permissions.ts — schema enums, not
 * data, and changing one is a migration either way.
 */
export {
  INCOME_BAND_OPTIONS,
  INCOME_BAND_LABELS,
  INCOME_BAND_DESCRIPTIONS,
  deriveIncomeBand,
  type IncomeBand,
} from "../../../lib/income-band.ts";

export const GRANT_PREFERENCE_LABELS = {
  prioritise_grant_recipients: "Prioritise organisations with previous grant history (360Giving)",
} as const;

export const GRANT_PREFERENCE_DESCRIPTIONS = {
  prioritise_grant_recipients:
    "Gives higher priority in your personal queue to experienced organisations with recorded grant funding awards from UK grantmakers and philanthropic foundations.",
} as const;

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

// F202: Follow-Up Timing Settings (F160 / F161 / F202).
export const DEFAULT_FIRST_FOLLOW_UP_DAYS = 7;
export const DEFAULT_SECOND_FOLLOW_UP_DAYS = 14;
export const MIN_FOLLOW_UP_DAYS = 1;
export const MAX_FIRST_FOLLOW_UP_DAYS = 60;
export const MAX_SECOND_FOLLOW_UP_DAYS = 90;

export function clampFollowUpDays(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null || value === undefined || value === "") return fallback;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  const rounded = Math.round(num);
  return Math.min(Math.max(rounded, min), max);
}
