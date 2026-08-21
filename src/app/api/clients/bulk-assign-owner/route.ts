import { NextResponse } from "next/server";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { assignOwnerRpcFailure, validateBulkReassignOwnership } from "@/lib/ownership";

/**
 * F253 — admin assigns (or reassigns) multiple clients to a CAM in one action.
 * Reuses reassign_ownership (matrix §3.11) with p_from_user_id = null (the bulk-assign path),
 * which processes the selected client IDs, updates their owner_id, moves open actions,
 * and writes one audit log entry per client.
 */

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(request: Request) {
  const authorization = await getCurrentActor("ownership:reassign", {
    route: "/clients",
  });
  if (!authorization.ok) return denied(authorization.reason);
  if (authorization.actor.role !== "admin") {
    return NextResponse.json(
      { error: "Only an admin may assign a client's owner." },
      { status: 403 },
    );
  }

  const rawBody = await request.json().catch(() => null);
  const validation = validateBulkReassignOwnership(rawBody ?? {});
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { organisationIds, newOwnerId, reason } = validation.data;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("reassign_ownership", {
    p_organisation_ids: organisationIds,
    p_new_owner_id: newOwnerId,
    p_reason: reason,
    p_from_user_id: null,
  });

  if (error) {
    await reportError(error, {
      operation: "clients.bulk_assign_owner",
      count: organisationIds.length,
    });
    const { status, error: message } = assignOwnerRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json(data, { status: 200 });
}
