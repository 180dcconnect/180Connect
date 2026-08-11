/**
 * F048 — decision logic behind the discrepancies admin route, kept out of the route
 * so it can be tested without a database or a request (same split as @/lib/duplicates).
 */

export type DiscrepancyStatus = "pending" | "resolved";
export type DiscrepancyChoice = "existing" | "incoming";

export type FieldDiscrepancyRow = {
  id: string;
  organisation_id: string;
  field_name: string;
  existing_value: string;
  existing_source: string;
  incoming_value: string;
  incoming_source: string;
  status: DiscrepancyStatus;
  resolved_choice: DiscrepancyChoice | null;
  resolved_value: string | null;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  notes: string | null;
  created_at: string;
  organisation: { legal_name: string } | null;
  resolved_by_user: { full_name: string | null; email: string } | null;
};

/** Shared PostgREST select, used by both the admin page's initial load and the GET route. */
export const FIELD_DISCREPANCY_SELECT = `
  id, organisation_id, field_name, existing_value, existing_source, incoming_value,
  incoming_source, status, resolved_choice, resolved_value, resolved_by_user_id,
  resolved_at, notes, created_at,
  organisation:organisations!organisation_id ( legal_name ),
  resolved_by_user:users!field_discrepancies_resolved_by_user_id_fkey ( full_name, email )
`;

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "The decision could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from resolve_field_discrepancy onto something safe to show
 * an admin. Every errcode below is one the RPC raises deliberately, with a message
 * written to be read by an admin (see
 * 20260811090000_create_field_discrepancies.sql) — no table or constraint names,
 * nothing internal. Passing those through is safe; everything else gets the
 * generic string (DoD: no stack traces or internals in a user-facing error).
 */
export function discrepancyRpcFailure(error: { code?: string; message?: string }): RpcFailure {
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
    case "22023":
      return { status: 400, error: error.message };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}
