/**
 * City normalization — Title Case + invalid-city detection.
 *
 * Problem: `organisations.city` was written verbatim from Charity Commission /
 * Companies House payloads. That left casing inconsistent (LONDON vs London vs
 * london) and let street fragments ("35 Ballards Lane", "1 Ardwyn Walk") and
 * county names ("Cumbria", "Surrey") leak into the city column, which the
 * /clients "Filter by city" facet then surfaces as if they were cities.
 */

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/**
 * Normalise a city value to Title Case ("first letter of each word capital").
 *
 * - Trims, lowercases, then capitalises the first letter after every word
 *   boundary (space, hyphen, dot). So "BIRMINGHAM" -> "Birmingham",
 *   "burton-on-trent" -> "Burton-On-Trent", "ST. ALBANS" -> "St. Albans",
 *   "newcastle upon tyne" -> "Newcastle Upon Tyne".
 * - Returns "" for null/empty, never null — callers that need null can map
 *   "" -> null for the DB.
 */
export function normalizeCity(value: string | null | undefined): string {
  if (value == null) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  // \b matches start of string, after space, hyphen, dot, etc.
  return lower.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Whether a stored city value is obviously not a city: numeric, postcode-like,
 * or a street fragment. Used to decide when to clear rather than title-case.
 */
export function isInvalidCityValue(city: string | null | undefined): boolean {
  if (city == null) return false;
  const t = city.trim();
  if (!t) return false;
  if (/^\d+\s*$/.test(t)) return true;
  if (UK_POSTCODE_RE.test(t)) return true;
  if (/\d/.test(t) && /\b(Ardwyn|Walk|Lane|Road|Avenue|Street|Grove|Close|Gardens?)\b/i.test(t)) return true;
  if (/^\d+\s+\w+\s+(Walk|Lane|Avenue|Street|Road)$/i.test(t)) return true;
  return false;
}

/**
 * Counties that appeared in the city column but are not cities. Kept explicit
 * so we don't silently invent a mapping — these are cleared to "" and
 * flagged for manual re-entry (or postcode-derived repair).
 */
export const COUNTY_CITY_VALUES = new Set([
  "Cumbria",
  "Surrey",
  "Essex",
  "East Sussex",
  "East Yorkshire",
]);

export function isCountyCityValue(city: string | null | undefined): boolean {
  if (!city) return false;
  return COUNTY_CITY_VALUES.has(city.trim()) || COUNTY_CITY_VALUES.has(normalizeCity(city));
}
