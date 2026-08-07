/**
 * F257 — decision logic behind the offboarding handover, kept out of the route so it
 * can be tested without a database or a request. The route keeps the IO: query, call
 * the RPC, re-query, call the second RPC.
 */

export type OwnedOrganisation = { id: string; legal_name: string };

export type OpenActionRow = {
  id: string;
  title: string;
  organisation_id: string;
  organisations: { legal_name: string } | null;
};

export type Holdings = {
  organisations: { id: string; legal_name: string; open_actions: number }[];
  crossOrgActions: { id: string; title: string; organisation: string }[];
};

/**
 * Splits what a CAM is holding the same way the two RPCs do.
 *
 * Actions on a client they own travel with that client when ownership moves, so
 * `reassign_ownership` covers them. Actions on anyone else's client are F169 work an
 * admin handed them, and only `reassign_actions` can reach those. Presenting them as
 * one number would let an admin conclude the second call was unnecessary.
 */
export function summariseHoldings(
  organisations: OwnedOrganisation[],
  openActions: OpenActionRow[],
): Holdings {
  const ownedIds = new Set(organisations.map((organisation) => organisation.id));

  return {
    organisations: organisations.map((organisation) => ({
      ...organisation,
      open_actions: openActions.filter(
        (action) => action.organisation_id === organisation.id,
      ).length,
    })),
    crossOrgActions: openActions
      .filter((action) => !ownedIds.has(action.organisation_id))
      .map((action) => ({
        id: action.id,
        title: action.title,
        organisation: action.organisations?.legal_name ?? "Unknown client",
      })),
  };
}

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "The handover was blocked. Refresh and try again.";

/**
 * Maps a Postgres error from either RPC onto something safe to show an admin.
 *
 * `22023` is the code both functions raise for the cases a human can fix — no reason,
 * a deactivated or viewer recipient — and those messages were written to be read by a
 * CAM, so they pass through. Everything else gets a fixed string: an unexpected
 * database error can carry table names, constraint names or fragments of a statement,
 * and none of that belongs in front of a user (DoD: no stack traces or internals).
 */
export function rpcFailureResponse(error: {
  code?: string;
  message?: string;
}): RpcFailure {
  if (error.code === "22023" && error.message?.trim()) {
    return { status: 400, error: error.message };
  }
  if (error.code === "42501") {
    return {
      status: 403,
      error: "You do not have permission to reassign client ownership.",
    };
  }
  return { status: 500, error: GENERIC_FAILURE };
}
