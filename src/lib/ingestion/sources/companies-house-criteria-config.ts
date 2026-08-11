// Companies House discovery criteria — the 3-tier mission-fit rule set, corrected
// and extended from 180DC's original pre-repo Python MVP script.
//
// Policy lives in code, reviewed like code (same convention as
// ../../client-criteria-config.ts): change this file and its tests in the same pull
// request when the team agrees new criteria, rather than an admin-editable database
// table. Both the manual "Import" button (Server Action) and the weekly cron route
// run in the same Next.js server runtime, so a plain import reaches both call sites
// with no extra plumbing.
//
// Tier A/B are strong evidence of mission fit (legal form itself), and bypass the
// F047 human-review hold — see classifyCompaniesHouseSourceConfidence in
// ../../standardize/companies-house.ts. Tier C is weaker (SIC-only) evidence and
// still needs review. Confirmed with Bashir (Project Leader), 9 Aug 2026.

/** Auto-include: this legal form alone is definitive evidence of mission fit. */
export const TIER_A_LEGAL_FORMS = [
  "charitable-incorporated-organisation",
  "scottish-charitable-incorporated-organisation",
  "further-education-or-sixth-form-college-corporation",
] as const;

/** Near-certain social-enterprise fit: one of these legal forms, CIC-registered. */
export const TIER_B_LEGAL_FORMS = [
  "private-limited-guarant-nsc",
  "private-limited-guarant-nsc-limited-exemption",
  "plc",
  "ltd",
] as const;
export const TIER_B_SUBTYPE = "community-interest-company";

/**
 * Weaker evidence: one of these legal forms, kept only if its SIC codes intersect
 * the allowlist below. Unlike the old MVP script, no per-company profile fetch is
 * needed for this — confirmed live (9 Aug 2026, against the real Companies House
 * API) that /advanced-search/companies items already carry `sic_codes` whenever
 * Companies House has that data for the company; a null value there is a genuine
 * absence (verified by cross-checking the same company's full /company/{number}
 * profile), not an endpoint gap.
 */
export const TIER_C_LEGAL_FORMS = ["royal-charter", "united-kingdom-societas"] as const;

/**
 * Corrected + extended from the original MVP script's 44-code list (9 aug 2026):
 *   - Dropped 9 codes that were SIC2003-era 4-digit codes (8010, 8021, 8022, 8030,
 *     8042, 8531, 8532, 9131, 9132) — Companies House's live API only speaks
 *     SIC2007, so these never matched anything; their 2007 equivalents are already
 *     covered by the 85xxx block below.
 *   - Added 88100 (social work for elderly/disabled, no accommodation) — present in
 *     the SIC2007 schema but missing from the original list.
 *   - Added impact-investor codes (64303, 64304, 66300), energy/sustainability codes
 *     (35110, 35140), and workforce-inclusion codes (78100, 78200) — none were in the
 *     original list despite being named in 180DC's mission (Impact Investors,
 *     Sustainability Focused Companies).
 */
export const TIER_C_SIC_ALLOWLIST = [
  "86101", "86102", "86210", "86220", "86230", "86900",
  "87100", "87200", "87300", "87900",
  "88100", "88910", "88990",
  "94990",
  "85100", "85200", "85310", "85320", "85410", "85421", "85422",
  "85510", "85520", "85530", "85590", "85600",
  "90010", "90020", "90030", "90040",
  "91011", "91012", "91020", "91030", "91040",
  "93110", "93120", "93130", "93191", "93199", "93210", "93290",
  "36000", "37000", "38110", "38120", "38210", "38220", "38310", "38320", "39000",
  "64303", "64304", "66300",
  "35110", "35140",
  "78100", "78200",
] as const;

/** Nationwide by default — no hardcoded city list like the old Yorkshire-only MVP. */
export const DEFAULT_LOCATION: string | undefined = undefined;

/** Any status other than this triggers an organisation_status_flags review flag. */
export const ALIVE_COMPANY_STATUS = "active";

/** Tunable once real Companies House-sourced organisation volume is known. */
export const STATUS_RECHECK_BATCH_SIZE = 400;

export type CompaniesHouseTierableItem = {
  company_type?: unknown;
  company_subtype?: unknown;
  sic_codes?: unknown;
};

export type CompaniesHouseTier = "A" | "B" | "C";

const TIER_A_SET: ReadonlySet<string> = new Set(TIER_A_LEGAL_FORMS);
const TIER_B_SET: ReadonlySet<string> = new Set(TIER_B_LEGAL_FORMS);
const TIER_C_SET: ReadonlySet<string> = new Set(TIER_C_LEGAL_FORMS);
const TIER_C_SIC_SET: ReadonlySet<string> = new Set(TIER_C_SIC_ALLOWLIST);

/**
 * Classifies a single Companies House advanced-search item (or any record carrying
 * the same three fields) against the tier rules. Pure — no I/O — so the discovery
 * adapter and the promotion pipeline can both call it and always agree.
 */
export function classifyCompaniesHouseTier(
  item: CompaniesHouseTierableItem,
): CompaniesHouseTier | null {
  const companyType = typeof item.company_type === "string" ? item.company_type : "";
  const companySubtype = typeof item.company_subtype === "string" ? item.company_subtype : "";
  const sicCodes = Array.isArray(item.sic_codes)
    ? item.sic_codes.filter((code): code is string => typeof code === "string")
    : [];

  if (TIER_A_SET.has(companyType)) return "A";
  if (TIER_B_SET.has(companyType) && companySubtype === TIER_B_SUBTYPE) return "B";
  if (TIER_C_SET.has(companyType) && sicCodes.some((code) => TIER_C_SIC_SET.has(code))) {
    return "C";
  }
  return null;
}
