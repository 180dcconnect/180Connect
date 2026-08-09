/**
 * F042 — decision logic behind the duplicates admin route, kept out of the route so it
 * can be tested without a database or a request (same split as @/lib/suppressions).
 */

export type MatchStatus = "pending" | "confirmed_match" | "confirmed_new" | "rejected";

export type EntityMatchCandidateRow = {
  id: string;
  raw_source_record_id: string;
  candidate_organisation_id: string | null;
  match_score: number;
  match_method: "exact_charity_number" | "fuzzy_name" | "address_match" | "manual";
  match_status: MatchStatus;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  candidate_organisation: { legal_name: string } | null;
  // charity_name (Charity Commission) / company_name (Companies House) — every
  // source's raw_payload shape is different (see write-organisations.ts header),
  // so both must be read here or one source's rows show as "Unknown incoming
  // record" in the admin panel.
  raw_source_record: { raw_payload: { charity_name?: string; company_name?: string } } | null;
  reviewed_by_user: { full_name: string | null; email: string } | null;
};

/** Shared PostgREST select, used by both the admin page's initial load and the GET route. */
export const ENTITY_MATCH_CANDIDATE_SELECT = `
  id, raw_source_record_id, candidate_organisation_id, match_score, match_method, match_status,
  reviewed_by_user_id, reviewed_at, notes, created_at,
  candidate_organisation:organisations!candidate_organisation_id ( legal_name ),
  raw_source_record:raw_source_records!raw_source_record_id ( raw_payload ),
  reviewed_by_user:users!entity_match_candidates_reviewed_by_user_id_fkey ( full_name, email )
`;

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "The decision could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from decide_duplicate_flag onto something safe to show an
 * admin. Every errcode below is one the RPC raises deliberately, with a message
 * written to be read by an admin (see 20260809150000_create_entity_match_candidates.sql)
 * — no table or constraint names, nothing internal. Passing those through is safe;
 * everything else gets the generic string (DoD: no stack traces or internals in a
 * user-facing error).
 */
export function duplicateRpcFailure(error: { code?: string; message?: string }): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: GENERIC_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "55000":
      return { status: 409, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}
