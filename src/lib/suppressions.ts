/**
 * F251 — decision logic behind the suppression admin route, kept out of the route
 * so it can be tested without a database or a request (same split as @/lib/offboard).
 */

export type SuppressionStatus = "pending" | "active" | "rejected" | "lifted";

export type SuppressionRow = {
  id: string;
  organisation_id: string;
  status: SuppressionStatus;
  reason: string;
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  organisations: { legal_name: string } | null;
  requested_by_user: { full_name: string | null; email: string } | null;
  decided_by_user: { full_name: string | null; email: string } | null;
};

/** Shared PostgREST select, used by both the admin page's initial load and the GET route. */
export const SUPPRESSION_SELECT = `
  id, organisation_id, status, reason, requested_by, decided_by, decided_at,
  decision_note, created_at,
  organisations ( legal_name ),
  requested_by_user:users!suppressions_requested_by_fkey ( full_name, email ),
  decided_by_user:users!suppressions_decided_by_fkey ( full_name, email )
`;

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "The suppression request could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from request_suppression / decide_suppression_request /
 * lift_suppression onto something safe to show an admin.
 *
 * Every errcode below is one the RPCs raise deliberately, with a message written
 * to be read by an admin (see 20260806100000_create_suppressions.sql and
 * 20260818130000_create_lift_suppression_rpc.sql) — no table or constraint names,
 * nothing internal. Passing those through is safe; everything else gets the
 * generic string, same reasoning as rpcFailureResponse in @/lib/offboard
 * (DoD: no stack traces or internals in a user-facing error).
 */
export function suppressionRpcFailure(error: {
  code?: string;
  message?: string;
}): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: GENERIC_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "23514":
      return { status: 400, error: error.message };
    case "23505":
    case "55000":
      return { status: 409, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}
