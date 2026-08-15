// Source priority — which data source wins when two of them disagree.
//
// Confirmed by Bashir on the 13 Aug 2026 midweek call and already implicit in
// docs/data-model/04-entities.md's legal_name note ("Companies House takes
// priority over CharityBase"): Companies House outranks the Charity Commission,
// and anything else is least-priority. Lower number = higher priority.
//
// This lives in its own module because two features now depend on the same rule
// and they must not drift: F042 stamps the number onto every
// entity_match_candidates row (write-organisations.ts), and F048 uses it to
// decide a field conflict without asking a human (discrepancies/
// detect-field-discrepancies.ts).

export const SOURCE_PRIORITY: Record<string, number> = {
  companies_house: 1,
  charity_commission: 2,
};

/**
 * Least priority, for any source this list hasn't been updated for yet (e.g.
 * find_that_charity, which has no documented priority rule). Used where a value
 * must be written regardless — see sourcePriority below.
 */
export const DEFAULT_SOURCE_PRIORITY = 99;

/**
 * The number to store for a source. Falls back to least-priority rather than
 * failing, because entity_match_candidates.source_priority is NOT NULL and an
 * unranked source must not block the insert outright.
 */
export function sourcePriority(source: string): number {
  return SOURCE_PRIORITY[source] ?? DEFAULT_SOURCE_PRIORITY;
}

/** Which side of a two-source conflict wins, or null if the rules can't say. */
export type PriorityWinner = "existing" | "incoming" | null;

/**
 * Decides a field conflict between two sources, or declines to.
 *
 * Deliberately stricter than sourcePriority: it returns null unless *both*
 * sources are explicitly ranked in SOURCE_PRIORITY. An unranked source is not
 * treated as 99-and-therefore-a-loser, because the two cases that produce one
 * are exactly the cases where a silent overwrite would be wrong — a source
 * nobody has ranked yet, and F048's "unknown" placeholder for an organisation
 * whose originating raw record can no longer be found. Falling back to 99 there
 * would let a known source silently overwrite a value whose provenance we can't
 * establish. Those go to a human instead, which is what the manual review queue
 * is for.
 *
 * Equal priority (the same source on both sides) is also null: a tie the ruleset
 * can't break is precisely the case Bashir's rule reserves for manual flagging.
 */
export function resolveBySourcePriority(
  existingSource: string,
  incomingSource: string,
): PriorityWinner {
  const existing = SOURCE_PRIORITY[existingSource];
  const incoming = SOURCE_PRIORITY[incomingSource];
  if (existing === undefined || incoming === undefined) return null;
  if (existing === incoming) return null;
  return existing < incoming ? "existing" : "incoming";
}
