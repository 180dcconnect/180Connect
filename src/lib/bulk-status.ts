/**
 * F064 — decision logic behind changing many clients' pipeline status at once,
 * kept out of the route so it can be tested without a database (same split as
 * @/lib/pipeline-status, which does the single-client half).
 */

import { formatOutreachStatus } from "./organisation-format.ts";

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE =
  "The pipeline statuses could not be changed. Nothing was updated — refresh and try again.";

/**
 * How many clients one bulk change may cover.
 *
 * Mirrors the ceiling inside set_outreach_status_bulk. Duplicated deliberately:
 * the database enforces it (a hand-built request cannot get past it) and the
 * client uses it to stop a CAM from assembling a selection that is going to be
 * refused. If one of the two ever moves, the other has to move with it.
 */
export const MAX_BULK_STATUS_CLIENTS = 500;

/**
 * Maps a Postgres error from set_outreach_status_bulk onto something safe to show
 * a CAM.
 *
 * Same contract as setOutreachStatusRpcFailure: every errcode below is one the
 * RPC raises deliberately with a message written to be read by the caller, so
 * passing those through is safe; anything else gets the generic string (DoD: no
 * stack traces or internals in a user-facing error).
 *
 * The generic string says "nothing was updated" because that is guaranteed here
 * in a way it is not for a loop of single writes — the RPC is one transaction, so
 * a failure of any kind rolled the whole batch back.
 */
export function setOutreachStatusBulkRpcFailure(error: {
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
    // 22023 is the RPC's own argument check — empty selection, or a batch over
    // the ceiling. A 400 rather than a 500: the request was understood and
    // refused, and the message tells the CAM what to change.
    case "22023":
      return { status: 400, error: error.message };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}

export type BulkStatusResult = {
  requested: number;
  changed: number;
  unchanged: number;
};

/**
 * Reads the RPC's jsonb return, which arrives from PostgREST as an untyped
 * value. A malformed shape is treated as a failure rather than being coerced to
 * zeroes: reporting "0 clients updated" for a call that in fact committed would
 * be worse than reporting an error for one that did.
 */
export function parseBulkStatusResult(value: unknown): BulkStatusResult | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { requested, changed, unchanged } = record;
  if (
    typeof requested !== "number" ||
    typeof changed !== "number" ||
    typeof unchanged !== "number"
  ) {
    return null;
  }
  return { requested, changed, unchanged };
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * What the CAM is told after the batch commits.
 *
 * The skipped count is never hidden. A CAM who selects 20 and is told "20
 * updated" when 5 were already on that status has been told something false
 * about their own data, and the whole point of showing a count before the change
 * (AC2) is that the counts can be trusted.
 */
export function bulkStatusSummary(result: BulkStatusResult, status: string): string {
  const label = formatOutreachStatus(status);
  if (result.changed === 0) {
    return `No change — ${result.requested === 1 ? "that client was" : `all ${result.requested} selected clients were`} already on ${label}.`;
  }
  const moved = `${plural(result.changed, "client")} moved to ${label}.`;
  if (result.unchanged === 0) return moved;
  return `${moved} ${plural(result.unchanged, "other")} ${result.unchanged === 1 ? "was" : "were"} already on it.`;
}

/**
 * Whether this actor may bulk-change this client's status — the UI half of the
 * permission rule the RPC enforces (owner or admin).
 *
 * F064's open question was "bulk update permission rules"; the answer is that
 * there are no bulk-specific rules. A CAM can change in bulk exactly what they
 * could change one at a time, so a row they cannot act on is not selectable in
 * the first place. Disabling the checkbox rather than letting the selection fail
 * at apply time is what keeps the batch atomic *and* usable: an all-or-nothing
 * write is only kind if you cannot accidentally build a selection that is
 * guaranteed to be refused.
 */
export function canBulkUpdateStatus(
  actor: { id: string; role: string },
  client: { owner_id: string | null },
): boolean {
  if (actor.role === "admin") return true;
  if (actor.role !== "cam") return false;
  return client.owner_id === actor.id;
}

/**
 * Why a row's checkbox is disabled, for the tooltip on it. Null when it is not.
 */
export function bulkSelectionBlockedReason(
  actor: { id: string; role: string },
  client: { owner_id: string | null },
): string | null {
  if (canBulkUpdateStatus(actor, client)) return null;
  if (actor.role !== "cam") return "Only a CAM or an admin can change a client's status.";
  return client.owner_id === null
    ? "Claim this client before changing its status."
    : "Only this client's owner or an admin can change its status.";
}
