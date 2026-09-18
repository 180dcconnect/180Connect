// F214 — Natural Language Charity Search (#209): the free half of the feature.
//
// Not every string typed into a search box is a question. "Leeds Community
// Foundation" is a name, and paying a model to discover that it is a name is
// the easiest money this feature could waste — so a query that carries no sign
// of intent never reaches the API at all and falls through to F052's plain
// name search instead. On the observed shape of CAM searches this is expected
// to keep a large share of submissions at zero cost.
//
// A false negative is cheap and visible: the CAM gets a literal name search and
// the UI says so, with the interpretation one click away. A false positive only
// costs ~$0.0006. The threshold is set accordingly — reluctant, not clever.

/**
 * Words that mean the string is describing organisations rather than naming one.
 *
 * Deliberately excludes the connective words that appear inside real charity
 * names — "and", "for", "the", "of", "trust", "foundation" — since including
 * them would send half the name searches in the app to the model.
 */
const INTENT_MARKERS = new Set([
  "in", "near", "around", "within", "across", "based",
  "with", "without", "who", "whose", "which", "that", "any", "anyone",
  "show", "find", "list", "give", "looking", "look", "need", "want", "me", "my",
  "under", "over", "above", "below", "between", "more", "less", "than",
  "most", "least", "best", "top", "worst", "high", "highest", "low", "lowest",
  "small", "smaller", "smallest", "tiny", "grassroots", "large", "larger",
  "largest", "big", "bigger", "biggest", "medium", "mid", "sized",
  "new", "recent", "recently", "still", "yet", "never", "not", "havent",
  "contacted", "uncontacted", "responded", "converted", "unanswered",
  "promising", "warm", "cold", "priority", "score", "scored", "unscored",
  "sector", "sectors", "type", "types", "income", "revenue", "turnover",
]);

const WORD = /[a-z0-9']+/g;

/**
 * True when a query is worth interpreting. Two ways to qualify: it uses a word
 * that describes rather than names, or it is simply too long to be a name.
 *
 * Under three words is never interpreted: no two-word string is a description,
 * and plenty are names.
 */
export function looksLikeNaturalLanguage(query: string | null | undefined): boolean {
  const words = query?.toLowerCase().match(WORD) ?? [];
  if (words.length < 3) return false;
  if (words.some((word) => INTENT_MARKERS.has(word))) return true;
  // Six or more words with no marker at all is still a description far more
  // often than it is a legal name, long as some registered names are.
  return words.length >= 6;
}

/**
 * The cache key for a query. Case, surrounding space and internal run-length all
 * collapse, so "Small Education Charities In Leeds" and "small education
 * charities in leeds" are one paid interpretation between them — across CAMs,
 * not just within one session.
 */
export function normaliseQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}
