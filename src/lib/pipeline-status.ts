/**
 * F145 — decision logic behind changing a client's pipeline status, kept out of the
 * route so it can be tested without a database (same split as @/lib/ownership).
 */

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "The pipeline status could not be changed. Refresh and try again.";

/**
 * Maps a Postgres error from set_outreach_status onto something safe to show a CAM.
 *
 * Every errcode below is one the RPC raises deliberately, with a message written to
 * be read by the caller (see 20260807100000_redefine_outreach_status_pipeline.sql) —
 * no table or constraint names, nothing internal. Passing those through is safe;
 * everything else gets the generic string (DoD: no stack traces or internals in a
 * user-facing error).
 */
export function setOutreachStatusRpcFailure(error: {
  code?: string;
  message?: string;
}): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: GENERIC_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}
