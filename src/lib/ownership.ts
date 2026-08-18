/**
 * F162/F163/F164 — decision logic behind claiming, assigning, and changing client ownership, kept
 * out of the route so it can be tested without a database (same split as
 * @/lib/suppressions).
 */

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "This client could not be claimed. Refresh and try again.";
const GENERIC_ASSIGN_FAILURE = "This client could not be assigned. Refresh and try again.";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ValidateReassignOwnershipInput = {
  organisationId: unknown;
  newOwnerId: unknown;
  reason: unknown;
  currentOwnerId?: unknown;
};

export type ValidateReassignOwnershipResult =
  | {
      ok: true;
      data: {
        organisationId: string;
        newOwnerId: string;
        reason: string;
      };
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Validates inputs for assigning (F163) or changing (F164) client ownership.
 */
export function validateReassignOwnership(
  input: ValidateReassignOwnershipInput,
): ValidateReassignOwnershipResult {
  if (typeof input.organisationId !== "string" || !UUID_REGEX.test(input.organisationId)) {
    return { ok: false, error: "That client could not be found." };
  }

  if (typeof input.newOwnerId !== "string" || !UUID_REGEX.test(input.newOwnerId)) {
    return { ok: false, error: "Choose a CAM to assign." };
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) {
    return {
      ok: false,
      error: "A reason is required so the handover can be understood later.",
    };
  }

  if (
    typeof input.currentOwnerId === "string" &&
    input.currentOwnerId.trim().toLowerCase() === input.newOwnerId.trim().toLowerCase()
  ) {
    return {
      ok: false,
      error: "Choose a different team member to change ownership.",
    };
  }

  return {
    ok: true,
    data: {
      organisationId: input.organisationId,
      newOwnerId: input.newOwnerId,
      reason,
    },
  };
}

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

/**
 * Maps a Postgres error from reassign_ownership (F257/F164, reused here for F163 —
 * see 20260810110000_close_admin_owner_id_direct_write.sql for why the admin path
 * goes through this RPC rather than a direct UPDATE) onto something safe to show
 * an admin assigning a client owner.
 *
 * reassign_ownership never raises 55000: unlike claim_organisation, the admin
 * assign form shows the current owner up front (the reused F165 conflict banner,
 * AC2) before the write happens, so there is no race to report — a stale pick just
 * overwrites, which is what "assign" means for an admin.
 */
export function assignOwnerRpcFailure(error: {
  code?: string;
  message?: string;
}): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: GENERIC_ASSIGN_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    case "22023":
      return { status: 400, error: error.message };
    default:
      return { status: 500, error: GENERIC_ASSIGN_FAILURE };
  }
}

