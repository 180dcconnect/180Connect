/**
 * F162 — decision logic behind claiming client ownership, kept out of the route so
 * it can be tested without a database (same split as @/lib/suppressions).
 */

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "This client could not be claimed. Refresh and try again.";

/**
 * Maps a Postgres error from claim_organisation onto something safe to show a CAM.
 *
 * Every errcode below is one the RPC raises deliberately, with a message written to
 * be read by the caller (see 20260806140000_create_claim_organisation_rpc.sql) — no
 * table or constraint names, nothing internal. Passing those through is safe;
 * everything else gets the generic string (DoD: no stack traces or internals in a
 * user-facing error). 55000 maps to 409 so the caller can distinguish "someone else
 * already owns this" — the conflict AC2 requires a warning for, not a generic
 * failure — from every other kind of rejection.
 */
export function claimOwnershipRpcFailure(error: {
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
    case "55000":
      return { status: 409, error: error.message };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}
