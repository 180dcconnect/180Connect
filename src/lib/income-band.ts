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
  "100k_500k",
  "500k_1m",
  "1m_10m",
  "10m_50m",
  "50m_100m",
  "over_100m",
] as const;

export type IncomeBand = (typeof INCOME_BAND_OPTIONS)[number];

export const INCOME_BAND_LABELS: Record<IncomeBand, string> = {
  under_10k: "Under £10k",
  "10k_100k": "£10k – £100k",
  "100k_500k": "£100k – £500k",
  "500k_1m": "£500k – £1m",
  "1m_10m": "£1m – £10m",
  "10m_50m": "£10m – £50m",
  "50m_100m": "£50m – £100m",
  over_100m: "Over £100m",
};

export const INCOME_BAND_DESCRIPTIONS: Record<IncomeBand, string> = {
  under_10k: "Micro / grassroots (< £10k)",
  "10k_100k": "Small non-profit (£10k – £100k)",
  "100k_500k": "Emerging mid-size (£100k – £500k)",
  "500k_1m": "Established mid-size (£500k – £1m)",
  "1m_10m": "Large non-profit (£1m – £10m)",
  "10m_50m": "Regional anchor (£10m – £50m)",
  "50m_100m": "Major national client (£50m – £100m)",
  over_100m: "Mega-NGO & global institution (> £100m)",
};

export const INCOME_BAND_SHORT_NAMES: Record<IncomeBand, string> = {
  under_10k: "Micro",
  "10k_100k": "Small",
  "100k_500k": "Emerging",
  "500k_1m": "Mid-size",
  "1m_10m": "Large",
  "10m_50m": "Anchor",
  "50m_100m": "National",
  over_100m: "Mega",
};

const GBP_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

/** Formats a monetary number into standard GBP, or returns "Not disclosed" if null/undefined. */
export function formatGbp(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return "Not disclosed";
  }
  return GBP_FORMATTER.format(amount);
}

/** Formats a monetary number into a compact string (e.g. £450k, £1.2m). */
export function formatCompactGbp(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return "Not disclosed";
  }
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}£${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (abs >= 1_000) {
    return `${sign}£${Math.round(abs / 1_000)}k`;
  }
  return `${sign}£${abs.toLocaleString("en-GB")}`;
}

/** Converts a numeric total income into the standard public.income_band enum value. */
export function deriveIncomeBand(totalIncome: number | null | undefined): IncomeBand | null {
  if (totalIncome === null || totalIncome === undefined || Number.isNaN(totalIncome)) {
    return null;
  }
  if (totalIncome < 10_000) return "under_10k";
  if (totalIncome <= 100_000) return "10k_100k";
  if (totalIncome <= 500_000) return "100k_500k";
  if (totalIncome <= 1_000_000) return "500k_1m";
  if (totalIncome <= 10_000_000) return "1m_10m";
  if (totalIncome <= 50_000_000) return "10m_50m";
  if (totalIncome <= 100_000_000) return "50m_100m";
  return "over_100m";
}
