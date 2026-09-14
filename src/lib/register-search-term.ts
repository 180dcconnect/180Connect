import { UK_CITIES } from "./uk-cities.ts";

/**
 * Reads what someone typed into the add-a-client register search.
 *
 * ── Why one box ──
 *
 * The search used to be two fields, name and postcode, and neither took a
 * registration number — typing `1012345` into "name" searched for charities
 * with those digits in their name and found nothing. A number is the most exact
 * thing a person can have (a letterhead, a website footer, an email signature),
 * so the box now accepts any of the four and works out which it was given:
 *
 * - 6–7 digits: a charity number, and — zero-padded — a company number, since
 *   people drop Companies House's leading zero. Both are looked up.
 * - 8 digits, or two letters and six digits (`SC123456`): a company number.
 * - A postcode or an outward code on its own (`S1 2HE`, `S1`): a postcode.
 * - Anything else is a name, optionally followed by a place — a postcode
 *   (`Community Trust S1`) or a UK town (`Community Trust Sheffield`).
 *
 * A trailing place is a guess: "Friends of Leeds" is a name, not "Friends of"
 * in Leeds. So the caller searches the whole text as a name as well, and shows
 * both — see `searchRegister`.
 *
 * Pure, so the rules have their own tests.
 */

const FULL_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;
const OUTWARD_CODE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

/**
 * Words that say nothing about which organisation is meant. "and" is here
 * because a register writes it as "&" as often as not, and matching either
 * spelling on 723,000 names costs more than the word tells us.
 */
const STOPWORDS = new Set(["the", "and", "ltd", "limited", "plc", "llp", "inc", "cic", "cio"]);

/** Joining words left dangling once a place is taken off the end. */
const CONNECTORS = new Set(["in", "near", "at"]);

const TOWNS = new Map(UK_CITIES.map((city) => [city.name.toLowerCase(), city.name]));

export type RegisterSearch =
  | { kind: "empty" }
  | {
      kind: "number";
      charityNumber: number | null;
      companyNumber: string | null;
      /** How the input was read, for the result line. */
      understood: string;
    }
  | {
      kind: "text";
      name: string | null;
      postcode: string | null;
      town: string | null;
      understood: string;
    };

function asPostcode(value: string): string | null {
  const full = value.trim().match(FULL_POSTCODE);
  if (full) return `${full[1]} ${full[2]}`.toUpperCase();
  if (OUTWARD_CODE.test(value.trim())) return value.trim().toUpperCase();
  return null;
}

function trimConnector(words: string[]): string[] {
  const kept = [...words];
  while (kept.length > 0 && CONNECTORS.has(kept[kept.length - 1].toLowerCase())) kept.pop();
  return kept;
}

function describe(name: string | null, postcode: string | null, town: string | null): string {
  const parts: string[] = [];
  if (name) parts.push(`names like “${name}”`);
  if (postcode) parts.push(name ? `near ${postcode}` : `postcode ${postcode}`);
  if (town) parts.push(`in ${town}`);
  return parts.join(" ");
}

export function parseRegisterSearch(raw: string): RegisterSearch {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 120);
  if (text.length < 2) return { kind: "empty" };

  const compact = text.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{6,7}$/.test(compact)) {
    const padded = compact.padStart(8, "0");
    return {
      kind: "number",
      charityNumber: Number(compact),
      companyNumber: padded,
      understood: `charity number ${compact} or company number ${padded}`,
    };
  }
  if (/^\d{8}$/.test(compact) || /^[A-Z]{2}\d{6}$/.test(compact)) {
    return { kind: "number", charityNumber: null, companyNumber: compact, understood: `company number ${compact}` };
  }

  const whole = asPostcode(text);
  if (whole) return { kind: "text", name: null, postcode: whole, town: null, understood: describe(null, whole, null) };

  const words = text.split(" ");

  // A postcode at the end: two tokens ("S1 2HE") before one ("S1", "S12HE").
  for (const take of [2, 1]) {
    if (words.length <= take) continue;
    const postcode = asPostcode(words.slice(-take).join(" "));
    if (!postcode) continue;
    if (take === 2 && !FULL_POSTCODE.test(words.slice(-take).join(" "))) continue;
    const name = trimConnector(words.slice(0, -take)).join(" ");
    if (!name) continue;
    return { kind: "text", name, postcode, town: null, understood: describe(name, postcode, null) };
  }

  // A UK town at the end — the longest match, so "Newcastle upon Tyne" wins over "Tyne".
  for (let take = Math.min(4, words.length - 1); take >= 1; take -= 1) {
    const town = TOWNS.get(words.slice(-take).join(" ").toLowerCase());
    if (!town) continue;
    const name = trimConnector(words.slice(0, -take)).join(" ");
    if (!name) continue;
    return { kind: "text", name, postcode: null, town, understood: describe(name, null, town) };
  }

  return { kind: "text", name: text, postcode: null, town: null, understood: describe(text, null, null) };
}

/**
 * A name reduced to comparable words: lower case, apostrophes and full stops
 * dropped so "St. Mary's" and "St Marys" agree, everything else that is not a
 * letter or digit a space.
 */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The words a name search matches on, each required somewhere in the name, in
 * any order. Single letters and the stopwords are left out — "The Trust Ltd"
 * should not require "the" and "ltd" to appear.
 */
export function searchWords(name: string): string[] {
  return normaliseName(name)
    .split(" ")
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

/**
 * The SQL twin of `normaliseName` for a register column.
 *
 * Only the characters that *join* a word are removed — apostrophes and full
 * stops. A typed word is letters and digits, so a contains-match never needs
 * commas or hyphens turned into spaces. Measured on the 723,000-row companies
 * file, each `replace` is a full pass over every name: eight of them doubled the
 * scan, three cost about as much as a plain `lower()`.
 */
export function normalisedNameSql(column: string): string {
  return `replace(replace(replace(lower(${column}), '''', ''), '’', ''), '.', '')`;
}

/**
 * A cheap LIKE pattern every name containing `word` (after normalising) must
 * also match on its raw lower-cased form: the word's letters, in order, with
 * anything between. Run before the normalised clause so the `replace` chain only
 * ever sees names that could match — on the companies file, most don't.
 *
 * `word` comes from `searchWords`, so it is letters and digits only and needs no
 * LIKE escaping.
 */
export function lettersInOrderPattern(word: string): string {
  return `%${word.split("").join("%")}%`;
}
