import { NextResponse } from "next/server";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import {
  assignOwnerRpcFailure,
  isNoOpReassignment,
  NO_OP_REASSIGNMENT_MESSAGE,
  validateReassignOwnership,
} from "@/lib/ownership";

/**
 * F163/F164 — admin assigns (F163) or changes/reassigns (F164) a client's owner, from the client profile.
 * Reuses reassign_ownership (built for F257/F164/F253, matrix §3.11) rather than a
 * new RPC: p_from_user_id is omitted, so the client's current owner (whatever it is,
 * including null) plays the outgoing owner, same as the F253 bulk-assign path. The
 * RPC is SECURITY DEFINER and re-checks app.is_admin() itself; the role check here
 * only saves a round trip for a CAM who reaches this route by other means.
 */

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) return denied(authorization.reason);
  if (authorization.actor.role !== "admin") {
    return NextResponse.json(
      { error: "Only an admin may assign or change a client's owner." },
      { status: 403 },
    );
  }

  const { id: organisationId } = await params;
  const json = await request.json().catch(() => null);

  const validation = validateReassignOwnership({
    organisationId,
    newOwnerId: json?.ownerId,
    reason: json?.reason,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const supabase = await createClient();

  // The no-op check runs against the owner the *database* holds, not one the
  // request supplied: the form's idea of the current owner can be a refresh out
  // of date, and a hand-rolled request can claim anything. A missing row falls
  // through to the RPC, which reports it as a skip rather than a 404 here.
  const { data: organisation } = await supabase
    .from("organisations")
    .select("owner_id")
    .eq("id", validation.data.organisationId)
    .maybeSingle();

  if (isNoOpReassignment(organisation?.owner_id, validation.data.newOwnerId)) {
    return NextResponse.json({ error: NO_OP_REASSIGNMENT_MESSAGE }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("reassign_ownership", {
    p_organisation_ids: [validation.data.organisationId],
    p_new_owner_id: validation.data.newOwnerId,
    p_reason: validation.data.reason,
    p_from_user_id: null,
  });

  if (error) {
    await reportError(error, { operation: "clients.assign_owner", organisationId });
    const { status, error: message } = assignOwnerRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json(data, { status: 200 });
}
