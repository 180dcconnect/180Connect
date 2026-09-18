// Finding a place: from a postcode, or by name.
//
// ── What this is for ──
//
// Somebody filling a gap on a client record usually has the organisation's
// address in front of them, not a list of councils. "S60 1DX" is a fact they
// can read off a letterhead; "Rotherham" is a fact they have to know. This
// answers the second from the first, so the place picker can be searched by
// postcode as well as by name.
//
// ── Why an API and not a table in the repo ──
//
// A postcode *area* is already known offline (postcode-area.ts: "S" is
// Sheffield), and it is too coarse to answer this — the S area covers
// Sheffield, Rotherham, Barnsley and Chesterfield, so "S60" would surface
// Sheffield and be wrong. Answering at district level needs ~3,000 rows of
// data nobody in this repo maintains, and a stale copy of it is worse than no
// copy: it would be confidently wrong after the next boundary change.
//
// postcodes.io is the ONS's open postcode data, free and unkeyed, and it is
// the authority for exactly this question. It is only ever asked about a
// postcode — never about a client, a person or anything the record holds — so
// nothing private leaves the app.
//
// ── What it promises ──
//
//   * It suggests; it does not write. The places come back as options a person
//     picks from, the same as every other place in the picker.
//   * It fails quietly. No network, a slow answer, an unknown postcode: all of
//     them return a plain outcome the caller can show, never an exception.
//   * Everything it returns is untrusted text from outside the app, validated
//     to strings here and rendered as data (PRD §11.5).
//
// ── Why searching by NAME is here too ──
//
// The Charity Commission publishes 174 local authorities, and they are the
// upper tier: "Essex", never "Colchester"; "Kent", never "Canterbury". The
// postcode lookup above answers with the lower tier, because that is what an
// address is in — so CO1 1AA surfaced Colchester while typing "Colchester"
// found nothing, which is exactly as confusing as it sounds. The same service
// publishes the Ordnance Survey place names, so a name is answered from the
// same place as a postcode and the two finally agree.

/** The one host this module talks to. */
const POSTCODES_API_ORIGIN = "https://api.postcodes.io";

/** How long to wait before giving up and letting the person type the place. */
export const POSTCODE_LOOKUP_TIMEOUT_MS = 4000;

/**
 * An outward code ("S1", "S60", "SW1A") or a full postcode ("S1 2HH"). Written
 * as two cases rather than one loose pattern because the API has two endpoints
 * and they take different things.
 */
const OUTWARD_CODE = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/;

function compact(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

/** Whether this search text is worth asking the postcode service about. */
export function looksLikePostcode(value: string | null | undefined): boolean {
  const text = compact(value ?? "");
  if (!text) return false;
  return FULL_POSTCODE.test(text) || OUTWARD_CODE.test(text);
}

/**
 * Where to ask. A full postcode resolves to one district; an outward code
 * resolves to every district it touches, which is why "S60" can legitimately
 * come back as both Rotherham and Sheffield.
 */
export function postcodeLookupUrl(value: string): string | null {
  const text = compact(value);
  if (FULL_POSTCODE.test(text)) {
    return `${POSTCODES_API_ORIGIN}/postcodes/${encodeURIComponent(text)}`;
  }
  if (OUTWARD_CODE.test(text)) {
    return `${POSTCODES_API_ORIGIN}/outcodes/${encodeURIComponent(text)}`;
  }
  return null;
}

/** A place name from the service: non-empty, trimmed, and a string. */
function placeStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => placeStrings(entry));
  }
  return [];
}

/**
 * The districts a lookup names, newest-wins deduplicated and in the order the
 * service gave them.
 *
 * `admin_district` is the local authority — the thing asked for. The parish and
 * ward are deliberately ignored: they are smaller than anything a client record
 * records, and offering "Brinsworth" as a client's city would put a value in
 * the field that no filter or score would ever match.
 */
export function districtsFromLookup(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object") return [];
  const districts = placeStrings((result as { admin_district?: unknown }).admin_district);
  return Array.from(new Set(districts));
}

export type PostcodeLookup =
  | { status: "found"; postcode: string; districts: string[] }
  | { status: "not_found"; message: string }
  | { status: "unavailable"; message: string };

export type PostcodeLookupDependencies = {
  /** Returns the parsed body, or null when the service said "no such postcode". */
  fetchJson: (url: string) => Promise<unknown | null>;
};

/**
 * Looks a postcode up and returns the places it sits in.
 *
 * Never throws — an unreachable service is an ordinary outcome, and the picker
 * it feeds still lets the place be typed or chosen by hand.
 */
export async function lookupPostcodePlaces(
  value: string,
  deps: PostcodeLookupDependencies,
): Promise<PostcodeLookup> {
  const url = postcodeLookupUrl(value);
  if (!url) {
    return { status: "not_found", message: "That does not look like a UK postcode." };
  }

  let payload: unknown | null;
  try {
    payload = await deps.fetchJson(url);
  } catch {
    return {
      status: "unavailable",
      message: "The postcode service could not be reached. Search for the place by name instead.",
    };
  }

  if (payload === null) {
    return { status: "not_found", message: "No UK postcode matches that." };
  }

  const districts = districtsFromLookup(payload);
  if (districts.length === 0) {
    return { status: "not_found", message: "No UK postcode matches that." };
  }

  return { status: "found", postcode: compact(value), districts };
}

/** Production wrapper; the decision logic stays injectable and testable above. */
export function createDefaultPostcodeLookupDependencies(): PostcodeLookupDependencies {
  return {
    fetchJson: async (url) => {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(POSTCODE_LOOKUP_TIMEOUT_MS),
        // The answer for a postcode does not change between two people asking
        // on the same afternoon.
        cache: "force-cache",
      });
      // 404 is the service's ordinary "no such postcode", not a failure.
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`postcodes.io responded ${response.status}`);
      return (await response.json()) as unknown;
    },
  };
}

/**
 * Below this, a search is too short to mean anything — "co" would return the
 * first few hundred places in the country and none of them on purpose.
 */
export const MIN_PLACE_SEARCH_LENGTH = 3;

/** How many named places to offer. Enough for the right one; short enough to read. */
const MAX_PLACE_RESULTS = 6;

/**
 * The kinds of place worth offering as a client's location.
 *
 * A client sits in a town, a city or a village. It does not sit in a hamlet or
 * a farmstead, and offering one would put a value in the field that no filter
 * or score would ever match — the same reason the postcode lookup ignores the
 * parish.
 */
const USEFUL_PLACE_TYPES = ["City", "Town", "Village", "Suburban Area"];

export type NamedPlace = {
  /** The place itself — what would be written to the record. */
  name: string;
  /** The county or unitary it sits in, for telling two same-named towns apart. */
  county: string | null;
};

export type PlaceSearch =
  | { status: "found"; places: NamedPlace[] }
  | { status: "none"; message: string }
  | { status: "unavailable"; message: string };

/** Where to ask for places called something. */
export function placeSearchUrl(query: string): string | null {
  const text = query.trim();
  if (text.length < MIN_PLACE_SEARCH_LENGTH) return null;
  return `${POSTCODES_API_ORIGIN}/places?q=${encodeURIComponent(text)}&limit=20`;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The places a name search found, filtered to the kinds a client can be in and
 * deduplicated by name-and-county — the service lists a place once per source
 * feature, so "Sheffield" can come back several times over.
 */
export function placesFromSearch(payload: unknown): NamedPlace[] {
  if (!payload || typeof payload !== "object") return [];
  const result = (payload as { result?: unknown }).result;
  if (!Array.isArray(result)) return [];

  const places: NamedPlace[] = [];
  const seen = new Set<string>();

  for (const entry of result) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = readString(row, "name_1");
    if (!name) continue;
    const localType = readString(row, "local_type");
    if (localType && !USEFUL_PLACE_TYPES.includes(localType)) continue;

    const county = readString(row, "county_unitary") ?? readString(row, "district_borough");
    const key = `${name.toLowerCase()}|${(county ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ name, county });
    if (places.length >= MAX_PLACE_RESULTS) break;
  }

  return places;
}

/**
 * Finds places called something.
 *
 * Never throws, for the same reason as the postcode lookup: the picker it feeds
 * still lets a place be chosen from the council list or typed by hand.
 */
export async function searchPlacesByName(
  query: string,
  deps: PostcodeLookupDependencies,
): Promise<PlaceSearch> {
  const url = placeSearchUrl(query);
  if (!url) {
    return { status: "none", message: "Type a little more to search for a place." };
  }

  let payload: unknown | null;
  try {
    payload = await deps.fetchJson(url);
  } catch {
    return {
      status: "unavailable",
      message: "The place service could not be reached. Choose from the list, or type the place.",
    };
  }

  const places = payload === null ? [] : placesFromSearch(payload);
  if (places.length === 0) {
    return { status: "none", message: "No UK town or city matches that." };
  }

  return { status: "found", places };
}
