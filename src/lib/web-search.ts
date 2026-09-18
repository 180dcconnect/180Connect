/**
 * "Have you just tried searching for it?" — the search link behind each missing
 * detail on the incomplete-records screen.
 *
 * The first thing anyone does about a client with no website is put its name and
 * the word "website" into a search engine. Making the admin retype the client's
 * name to do that is the kind of friction that ends with the field left blank, so
 * the card offers the search itself, pre-filled, one tap away.
 *
 * The queries are deliberately natural-language questions rather than a query
 * language: "What is Sheffield Mind's website?" is easier to understand and edit
 * than a quoted name followed by a keyword. Nothing here reads or writes a record
 * — it is a URL, so a viewer gets the same link an admin does.
 *
 * Pure and dependency-free, so it can be imported under plain `node --test` — the
 * same rule `organisation-format.ts` follows.
 */

/** The five details an incomplete-records card can be missing. */
export type SearchableField = "website" | "mission" | "sector" | "email" | "city";

/**
 * What to add to the client's name to find each detail.
 *
 * `mission` and `city` are the words the person searching would use, not the
 * field's name in the database: "mission statement" finds a charity's own
 * description, and "address" is what a register entry publishes, where "city"
 * mostly finds weather and football fixtures.
 */
const FIELD_SEARCH_TERMS: Record<SearchableField, string> = {
  website: "website",
  mission: "mission statement",
  sector: "sector",
  email: "email address",
  city: "address",
};

/**
 * The search a person would run for one missing detail, e.g.
 * `What is Sheffield Mind's mission statement?`.
 *
 * The name is trimmed; an empty name (never true for a real record) falls back to
 * the question without the name.
 */
export function fieldSearchQuery(field: SearchableField, clientName: string): string {
  const name = clientName.trim().replaceAll('"', "");
  const term = FIELD_SEARCH_TERMS[field];
  return name ? `What is ${name}'s ${term}?` : `What is the ${term}?`;
}

/** That search, as an address a link can open. */
export function webSearchHref(field: SearchableField, clientName: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(
    fieldSearchQuery(field, clientName),
  )}`;
}

/** The words on the link. One phrasing, so it reads the same on every field. */
export const WEB_SEARCH_LABEL = "Search";
