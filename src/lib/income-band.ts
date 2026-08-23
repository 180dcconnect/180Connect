// Canonical income-band domain, shared by everything that names the
// public.income_band enum values or derives a band from a numeric income.
//
// Source of truth for the VALUES is the database enum
// public.income_band (supabase/migrations/20260804180000_create_org_children.sql),
// mirrored here as a literal list rather than read from the database, same
// as ROLES in src/lib/auth/permissions.ts — these are schema enums, not
// data, and changing one is a migration either way.
//
// Previously this list lived in
// src/app/settings/outreach-preferences/constants.ts, which made an app
// settings module the owner of a schema-wide domain; that file now
// re-exports from here so lib-side consumers (F091 size scoring,
// visible-clients queue ordering) can use the same values and derivation
// without importing upward out of src/app.

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

export const INCOME_BAND_DESCRIPTIONS: Record<IncomeBand, string> = {
  under_10k: "Micro / grassroots (< £10k)",
  "10k_100k": "Small non-profit (£10k – £100k)",
  "100k_1m": "Medium charity (£100k – £1m)",
  over_1m: "Large institution (> £1m)",
};

/** Converts a numeric total income into the standard public.income_band enum value. */
export function deriveIncomeBand(totalIncome: number | null | undefined): IncomeBand | null {
  if (totalIncome === null || totalIncome === undefined || Number.isNaN(totalIncome)) {
    return null;
  }
  if (totalIncome < 10_000) return "under_10k";
  if (totalIncome <= 100_000) return "10k_100k";
  if (totalIncome <= 1_000_000) return "100k_1m";
  return "over_1m";
}
