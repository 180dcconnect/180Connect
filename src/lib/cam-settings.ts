import {
  GEOGRAPHIC_REACH_LABELS,
  INCOME_BAND_LABELS,
  type GeographicReach,
  type IncomeBand,
} from "../app/settings/outreach-preferences/constants.ts";
import { describeIncomeRange, isIncomeRangeActive } from "./income-range.ts";

export type CamUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: "cam" | "admin" | "viewer";
  is_active: boolean;
};

export type CamOutreachPreferences = {
  user_id: string;
  preferred_geographic_reach: GeographicReach[];
  preferred_sectors: string[];
  preferred_income_bands: IncomeBand[];
  /** F198 — the size range in pounds; replaces the bands when set. */
  preferred_income_min?: number | null;
  preferred_income_max?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
};

/**
 * What a CAM's size preference says, for read-only views: the exact range when
 * one is saved, otherwise the legacy band labels.
 */
export function getIncomePreferenceLabels(
  preferences: CamOutreachPreferences | null | undefined,
): string[] {
  if (!preferences) return [];
  const range = {
    min: preferences.preferred_income_min ?? null,
    max: preferences.preferred_income_max ?? null,
  };
  if (isIncomeRangeActive(range)) return [describeIncomeRange(range)!];
  return getIncomeBandLabels(preferences.preferred_income_bands);
}

/**
 * Checks whether any outreach preference has been customized for this CAM.
 * Returns false if all arrays are empty or preferences is null.
 */
export function hasConfiguredPreferences(
  preferences: CamOutreachPreferences | null | undefined,
): boolean {
  if (!preferences) return false;
  return (
    (preferences.preferred_geographic_reach?.length ?? 0) > 0 ||
    (preferences.preferred_sectors?.length ?? 0) > 0 ||
    (preferences.preferred_income_bands?.length ?? 0) > 0 ||
    preferences.preferred_income_min != null ||
    preferences.preferred_income_max != null
  );
}

/**
 * Maps raw geographic reach codes to human-readable display labels.
 */
export function getGeographicReachLabels(
  reach: GeographicReach[] | null | undefined,
): string[] {
  if (!reach || reach.length === 0) return [];
  return reach.map((r) => GEOGRAPHIC_REACH_LABELS[r] ?? r);
}

/**
 * Maps raw income band codes to human-readable display labels.
 */
export function getIncomeBandLabels(
  bands: IncomeBand[] | null | undefined,
): string[] {
  if (!bands || bands.length === 0) return [];
  return bands.map((b) => INCOME_BAND_LABELS[b] ?? b);
}

/**
 * Normalizes sectors array, trimming and filtering out empty strings.
 */
export function getSanitizedSectors(
  sectors: string[] | null | undefined,
): string[] {
  if (!sectors || sectors.length === 0) return [];
  return sectors.map((s) => s.trim()).filter(Boolean);
}

/**
 * F187 Privacy Guard (AC2):
 * Sanitizes and extracts strictly queue-relevant configuration data, discarding
 * any unintended personal or profile attributes.
 */
export function sanitizeQueuePreferences(
  raw: Partial<CamOutreachPreferences> | null | undefined,
): CamOutreachPreferences | null {
  if (!raw || !raw.user_id) return null;

  return {
    user_id: raw.user_id,
    preferred_geographic_reach: Array.isArray(raw.preferred_geographic_reach)
      ? (raw.preferred_geographic_reach as GeographicReach[])
      : [],
    preferred_sectors: Array.isArray(raw.preferred_sectors)
      ? raw.preferred_sectors.filter((s): s is string => typeof s === "string")
      : [],
    preferred_income_bands: Array.isArray(raw.preferred_income_bands)
      ? (raw.preferred_income_bands as IncomeBand[])
      : [],
    preferred_income_min:
      typeof raw.preferred_income_min === "number" ? raw.preferred_income_min : null,
    preferred_income_max:
      typeof raw.preferred_income_max === "number" ? raw.preferred_income_max : null,
    updated_at: raw.updated_at ?? null,
    created_at: raw.created_at ?? null,
  };
}
