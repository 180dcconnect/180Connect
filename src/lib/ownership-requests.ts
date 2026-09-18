/**
 * #408 — Request Client Ownership (admin-approved handover).
 *
 * The decision logic behind the request/decide routes, kept out of the routes so it
 * can be tested without a database or a request (same split as @/lib/suppressions and
 * @/lib/offboard).
 *
 * The rule this file encodes, decided by the Project Leader on #406: a CAM never
 * overrides another CAM's ownership. Requesting is the only route, and it ends in an
 * admin's decision. Nothing here grants access — it only decides whether the *ask* is
 * available and what to call it.
 */

import type { AppRole } from "./auth/permissions.ts";

export type OwnershipRequestStatus = "pending" | "approved" | "rejected";

export type OwnershipRequestRow = {
  id: string;
  organisation_id: string;
  requested_by: string;
  current_owner_id: string | null;
  status: OwnershipRequestStatus;
  reason: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  organisations: { legal_name: string; owner_id: string | null } | null;
  requested_by_user: { full_name: string | null; email: string } | null;
  current_owner_user: { full_name: string | null; email: string } | null;
  decided_by_user: { full_name: string | null; email: string } | null;
};

/** Shared PostgREST select, used by the admin page's initial load and the GET route. */
export const OWNERSHIP_REQUEST_SELECT = `
  id, organisation_id, requested_by, current_owner_id, status, reason,
  decided_by, decided_at, decision_note, created_at,
  organisations ( legal_name, owner_id ),
  requested_by_user:users!ownership_requests_requested_by_fkey ( full_name, email ),
  current_owner_user:users!ownership_requests_current_owner_id_fkey ( full_name, email ),
  decided_by_user:users!ownership_requests_decided_by_fkey ( full_name, email )
`;

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "The ownership request could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from request_client_ownership / decide_ownership_request onto
 * something safe to show a user.
 *
 * Every errcode below is one the two RPCs raise deliberately, with a message written
 * to be read by a CAM or an admin (see 20260818120000_create_ownership_requests.sql) —
 * no table or constraint names, nothing internal. Everything else gets the generic
 * string (DoD: no stack traces or internals in a user-facing error). Same shape as
 * suppressionRpcFailure.
 */
export function ownershipRequestRpcFailure(error: {
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

export type RequestAvailability =
  | { available: true }
  | { available: false; reason: "not_cam" | "unowned" | "already_owner" | "already_pending" };

/**
 * Whether the "Request this client" action should be offered, and if not, why.
 *
 * Mirrors request_client_ownership's own guards so the UI does not offer a button that
 * the RPC will refuse. The RPC stays the enforcement point — this is presentation, and
 * is never the only thing standing between a CAM and a write.
 */
export function ownershipRequestAvailability({
  ownerId,
  actorId,
  actorRole,
  hasPendingRequest,
}: {
  ownerId: string | null;
  actorId: string;
  actorRole: AppRole;
  hasPendingRequest: boolean;
}): RequestAvailability {
  // An admin reassigns directly and would be asking themselves; a viewer owns nothing.
  if (actorRole !== "cam") return { available: false, reason: "not_cam" };
  if (!ownerId) return { available: false, reason: "unowned" };
  if (ownerId === actorId) return { available: false, reason: "already_owner" };
  if (hasPendingRequest) return { available: false, reason: "already_pending" };
  return { available: true };
}

/** What a CAM is told about a request they have already made. */
export function pendingRequestNotice(ownerName?: string | null): string {
  const name = ownerName?.trim() || "another team member";
  return `You have asked an admin to hand this client over from ${name}. It is still pending — ownership has not changed.`;
}

export function decidedRequestNotice(
  status: Exclude<OwnershipRequestStatus, "pending">,
  decisionNote?: string | null,
): string {
  const note = decisionNote?.trim();
  const head =
    status === "approved"
      ? "An admin approved your request for this client."
      : "An admin declined your request for this client. Ownership has not changed.";
  return note ? `${head} Note: ${note}` : head;
}
