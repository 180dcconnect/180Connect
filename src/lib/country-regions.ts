/**
 * World region for each country the Charity Commission register publishes.
 *
 * **Why this exists.** A charity's declared countries arrive as an alphabetical
 * list, and alphabetical is the one order that tells a reader nothing. "Angola,
 * Armenia, Azerbaijan, Bangladesh…" could be an African health charity or a
 * global emergency-response operation, and the reader has to hold fifty-five
 * names in their head to find out. Grouped, the same list answers it in one
 * line: Oxfam is 22 African countries, 14 Asian, 11 across Latin America. That
 * shape is what someone opening the Financials tab is actually looking for, and
 * the names underneath are the detail behind it.
 *
 * **Keyed on ISO codes, not names.** `country-flags.ts` already normalises all
 * 275 register labels — "Congo (Democratic Republic)", "Burma", "Yemen (Republic
 * of)" — down to 252 ISO 3166-1 alpha-2 codes. Mapping from those means this
 * file never has to match a register spelling, and a label the register renames
 * keeps working as long as the flag map still resolves it.
 *
 * **The groupings are operational, not geographic.** They are the buckets a CAM
 * thinks in when sizing an international charity, which is why the Middle East
 * is its own region rather than part of Asia, and why Latin America and the
 * Caribbean are one. Two judgement calls worth naming: Turkey sits under Middle
 * East, because for a UK charity operating there the work is almost always tied
 * to Syria rather than to Europe; and the Caucasus states sit under Asia, the
 * usual "Eastern Europe and Central Asia" convention having no home here.
 */

export type WorldRegion =
  | "Africa"
  | "Asia"
  | "Middle East"
  | "Europe"
  | "Latin America and the Caribbean"
  | "North America"
  | "Oceania"
  | "Antarctic and Southern Ocean";

/**
 * Display order — roughly by how often UK charities work there, so the common
 * regions lead and the long tail does not push them down.
 */
export const REGION_ORDER: readonly WorldRegion[] = [
  "Africa",
  "Asia",
  "Middle East",
  "Latin America and the Caribbean",
  "Europe",
  "North America",
  "Oceania",
  "Antarctic and Southern Ocean",
];

/** Short forms, for a legend that has to fit on one line. */
export const REGION_SHORT: Record<WorldRegion, string> = {
  Africa: "Africa",
  Asia: "Asia",
  "Middle East": "Middle East",
  Europe: "Europe",
  "Latin America and the Caribbean": "Latin America",
  "North America": "North America",
  Oceania: "Oceania",
  "Antarctic and Southern Ocean": "Antarctic",
};

/**
 * Region membership, written as region -> codes because that is the direction a
 * human can proofread. Inverted once, below, into the lookup the callers use.
 */
const MEMBERS: Record<WorldRegion, readonly string[]> = {
  Africa: [
    "AC", "AO", "BF", "BI", "BJ", "BW", "CD", "CF", "CG", "CI", "CM", "CV",
    "DJ", "DZ", "EG", "EH", "ER", "ET", "GA", "GH", "GM", "GN", "GQ", "GW",
    "IO", "KE", "KM", "LR", "LS", "LY", "MA", "MG", "ML", "MR", "MU", "MW",
    "MZ", "NA", "NE", "NG", "RE", "RW", "SC", "SD", "SH", "SL", "SN", "SO",
    "SS", "ST", "SZ", "TA", "TD", "TG", "TN", "TZ", "UG", "YT", "ZA", "ZM",
    "ZW",
  ],
  Asia: [
    "AF", "AM", "AZ", "BD", "BN", "BT", "CC", "CN", "CX", "GE", "HK", "ID",
    "IN", "JP", "KG", "KH", "KP", "KR", "KZ", "LA", "LK", "MM", "MN", "MO",
    "MV", "MY", "NP", "PH", "PK", "SG", "TH", "TJ", "TL", "TM", "TW", "UZ",
    "VN",
  ],
  "Middle East": [
    "AE", "BH", "IL", "IQ", "IR", "JO", "KW", "LB", "OM", "PS", "QA", "SA",
    "SY", "TR", "YE",
  ],
  Europe: [
    "AD", "AL", "AT", "AX", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE",
    "DK", "EE", "ES", "FI", "FO", "FR", "GB", "GG", "GI", "GR", "HR", "HU",
    "IE", "IM", "IS", "IT", "JE", "LI", "LT", "LU", "LV", "MC", "MD", "ME",
    "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "RU", "SE", "SI", "SJ",
    "SK", "SM", "UA", "VA", "XK",
  ],
  "Latin America and the Caribbean": [
    "AG", "AI", "AR", "AW", "BB", "BL", "BM", "BO", "BQ", "BR", "BS", "BZ",
    "CL", "CO", "CR", "CU", "CW", "DM", "DO", "EC", "FK", "GD", "GF", "GP",
    "GT", "GY", "HN", "HT", "JM", "KN", "KY", "LC", "MF", "MQ", "MS", "MX",
    "NI", "PA", "PE", "PR", "PY", "SR", "SV", "SX", "TC", "TT", "UY", "VC",
    "VE", "VG", "VI",
  ],
  "North America": ["CA", "GL", "PM", "US"],
  Oceania: [
    "AS", "AU", "CK", "FJ", "FM", "GU", "KI", "MH", "MP", "NC", "NF", "NR",
    "NU", "NZ", "PF", "PG", "PN", "PW", "SB", "TK", "TO", "TV", "UM", "VU",
    "WF", "WS",
  ],
  "Antarctic and Southern Ocean": ["AQ", "BV", "GS", "HM", "TF"],
};

const BY_CODE: Record<string, WorldRegion> = {};
for (const region of Object.keys(MEMBERS) as WorldRegion[]) {
  for (const code of MEMBERS[region]) BY_CODE[code] = region;
}

/** Every code this module knows, for the coverage test. */
export const MAPPED_CODES: readonly string[] = Object.keys(BY_CODE);

/**
 * The region a country belongs to, or null when the code is one this module has
 * never been told about.
 *
 * Null rather than a guess: a country landing in the wrong continent is worse
 * than one the caller quietly counts as ungrouped, and the coverage test keeps
 * null from happening for anything the register actually publishes.
 */
export function regionForIso(iso: string | null | undefined): WorldRegion | null {
  if (!iso) return null;
  return BY_CODE[iso.trim().toUpperCase()] ?? null;
}
