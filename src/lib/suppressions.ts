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

const GENERIC_FAILURE = "The suppression change could not be saved. Refresh the page and try again.";

/**
 * Maps a Postgres error from request_suppression / decide_suppression_request /
 * lift_suppression onto something safe to show an admin.
 *
 * The database messages include internal nouns and row ids, so even the expected
 * codes are translated here. This function is the UI boundary: an admin gets the
 * next useful action, never a Postgres sentence.
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
      return { status: 403, error: "Only an admin can make this suppression change." };
    case "23514":
      return { status: 400, error: "Enter a reason before saving this suppression change." };
    case "23505":
      return {
        status: 409,
        error: "This client already has a suppression request or active suppression.",
      };
    case "55000":
      return {
        status: 409,
        error: "This suppression has already changed. Refresh the page to see its current status.",
      };
    case "P0002":
      return {
        status: 404,
        error: "This suppression or client could not be found. Refresh the page and try again.",
      };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}
