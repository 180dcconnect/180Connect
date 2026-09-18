// F113/F213 — the search and filter half of the admin generation history.
//
// The page used to fetch every generation, full prompt and output included, and
// page through them in the browser. Nothing about that is searchable: the thing
// an admin types ("Sheffield", a subject line, a model) has to reach the
// database, or it is a filter over whatever happened to be on screen. This
// module is the pure half of that — the terms, the page window and their
// validation — so the page itself only wires them to a query.
//
// Same pure/DI split as generation-history.ts beside it: no database, no React,
// so the escaping can be tested directly instead of through a live query.

/** The page sizes the history offers. */
export const GENERATION_PAGE_SIZES = [5, 10, 15, 20] as const;

/** Where the list opens. */
export const DEFAULT_GENERATION_PAGE_SIZE = 10;

/**
 * Longest accepted search term. A client name or a subject fragment fits
 * comfortably; a pasted paragraph does not, and it is a query string that ends
 * up in a server log.
 */
export const GENERATION_SEARCH_MAX_LENGTH = 80;

/**
 * How many clients a search term may match before the search stops widening.
 * Bounded because the client half of the search has to be resolved to the
 * clients' messages before it can be asked of the generations table — an
 * unbounded list of ids is a query string nobody should send.
 */
export const GENERATION_CLIENT_MATCH_LIMIT = 50;

/** How many of those clients' messages are followed. */
export const GENERATION_MESSAGE_MATCH_LIMIT = 400;

export type GenerationEdited = "yes" | "no";

export type GenerationHistoryFilters = {
  /** Free text: a client name, or a fragment of what the model was asked to write. */
  search: string | null;
  /** Models to include. Empty = every model. */
  models: string[];
  /** Edited before sending (yes) or sent exactly as generated (no). */
  edited: GenerationEdited | null;
  /** The team member who generated it. */
  sentBy: string | null;
  /** True when the search term matched more clients than could be followed. */
  clientMatchesTruncated: boolean;
};

/**
 * The term as typed, or null. Whitespace is collapsed: a double space in a name
 * is invisible to the reader and would otherwise change the query.
 */
export function cleanSearchTerm(value: string | undefined | null): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, GENERATION_SEARCH_MAX_LENGTH);
}

/**
 * Escapes the `%` and `_` a reader typed so they match themselves rather than
 * acting as wildcards (`_` is one character in SQL LIKE; without this,
 * "a_b" would match "axb").
 */
function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/**
 * The `ilike` pattern for a term: a contains-match, with the reader's own
 * wildcards neutralised.
 */
export function generationSearchPattern(term: string): string {
  return `%${escapeLike(term)}%`;
}

/**
 * The same term, made safe to place inside a PostgREST `or=(…)` expression.
 *
 * The expression is a comma-separated list, so a comma inside a value ends the
 * condition early and the rest of the reader's text is parsed as query syntax.
 * Parentheses and quotes are dropped for the same reason. Nothing here pretends
 * the term matched: what remains is still a contains-match on what the reader
 * typed, minus the punctuation that cannot survive the trip.
 */
export function orSafeSearchTerm(term: string): string {
  return escapeLike(term).replace(/[,()"'\\]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The `or` expression for the free-text search: the subject the model wrote, or
 * any message belonging to a client whose name matches.
 *
 * Both sides are columns of `ai_generations` itself, which is what makes this
 * expressible: the client half is resolved to message ids first (`clientMessageIds`),
 * so the query never needs to filter through the embedded table.
 *
 * Returns null when there is nothing to search for — the caller then leaves the
 * query unfiltered rather than matching nothing.
 */
export function generationSearchOrExpression(
  term: string,
  clientMessageIds: readonly string[],
): string | null {
  const safe = orSafeSearchTerm(term);
  const subjectClause = safe ? `generated_subject.ilike.%${safe}%` : null;
  const ids = clientMessageIds.filter((id) => id.length > 0);
  const clientClause = ids.length > 0 ? `outreach_message_id.in.(${ids.join(",")})` : null;

  if (subjectClause && clientClause) return `${subjectClause},${clientClause}`;
  return subjectClause ?? clientClause;
}

/** Normalises the page window: 1-based, and never wider than the list offers. */
export function parseGenerationPage(
  page: string | undefined,
  pageSize: string | undefined,
): { page: number; pageSize: number } {
  const parsedPage = Number(page);
  const parsedSize = Number(pageSize);
  const size = (GENERATION_PAGE_SIZES as readonly number[]).includes(parsedSize)
    ? parsedSize
    : DEFAULT_GENERATION_PAGE_SIZE;
  return {
    page: Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1,
    pageSize: size,
  };
}

/** The models a query string asks for, deduplicated and trimmed. */
export function parseModels(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set<string>();
  for (const entry of values) {
    const model = entry.trim();
    if (model) seen.add(model);
  }
  return [...seen];
}

export function parseEdited(value: string | undefined): GenerationEdited | null {
  return value === "yes" || value === "no" ? value : null;
}

/**
 * The filters a search is carrying, for the summary under the history heading.
 * Returns null when nothing is narrowing the list, so a caller can skip the line
 * entirely rather than printing "no filters".
 */
export function describeGenerationFilters(
  filters: Pick<GenerationHistoryFilters, "search" | "models" | "edited" | "sentBy">,
  teamMemberName?: string | null,
): string | null {
  const parts: string[] = [];
  if (filters.search) parts.push(`“${filters.search}”`);
  if (filters.models.length > 0) parts.push(filters.models.join(", "));
  if (filters.edited === "yes") parts.push("edited before sending");
  if (filters.edited === "no") parts.push("sent as generated");
  if (filters.sentBy) parts.push(`generated by ${teamMemberName ?? "one team member"}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
