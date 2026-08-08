/**
 * F042 — decision logic behind the duplicates admin route, kept out of the route so it
 * can be tested without a database or a request (same split as @/lib/suppressions).
 */

export type PotentialDuplicateStatus = "pending" | "confirmed_duplicate" | "not_duplicate";

export type PotentialDuplicateRow = {
  id: string;
  raw_source_record_id: string;
  matched_organisation_id: string;
  matched_on: "registration_number" | "name_and_postcode";
  status: PotentialDuplicateStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  matched_organisation: { legal_name: string } | null;
  raw_source_record: { raw_payload: { charity_name?: string } } | null;
  decided_by_user: { full_name: string | null; email: string } | null;
};

/** Shared PostgREST select, used by both the admin page's initial load and the GET route. */
export const POTENTIAL_DUPLICATE_SELECT = `
  id, raw_source_record_id, matched_organisation_id, matched_on, status,
  decided_by, decided_at, decision_note, created_at,
  matched_organisation:organisations!matched_organisation_id ( legal_name ),
  raw_source_record:raw_source_records!raw_source_record_id ( raw_payload ),
  decided_by_user:users!potential_duplicates_decided_by_fkey ( full_name, email )
`;

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "The decision could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from decide_duplicate_flag onto something safe to show an
 * admin. Every errcode below is one the RPC raises deliberately, with a message
 * written to be read by an admin (see 20260807120000_create_potential_duplicates.sql)
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
