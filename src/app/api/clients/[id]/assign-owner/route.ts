import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { assignOwnerRpcFailure } from "@/lib/ownership";

/**
 * F163 — admin assigns (or reassigns) a client's owner, from the client profile.
 * Reuses reassign_ownership (built for F257/F164/F253, matrix §3.11) rather than a
 * new RPC: p_from_user_id is omitted, so the client's current owner (whatever it is,
 * including null) plays the outgoing owner, same as the F253 bulk-assign path. The
 * RPC is SECURITY DEFINER and re-checks app.is_admin() itself; the role check here
 * only saves a round trip for a CAM who reaches this route by other means.
 */

const Body = z.object({
  ownerId: z.uuid(),
  reason: z.string().trim().min(1, "A reason is required so the handover can be understood later."),
});

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
      { error: "Only an admin may assign a client's owner." },
      { status: 403 },
    );
  }

  const { id: organisationId } = await params;
  if (!z.uuid().safeParse(organisationId).success) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 400 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Choose a CAM and give a reason." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("reassign_ownership", {
    p_organisation_ids: [organisationId],
    p_new_owner_id: parsed.data.ownerId,
    p_reason: parsed.data.reason,
    p_from_user_id: null,
  });

  if (error) {
    await reportError(error, { operation: "clients.assign_owner", organisationId });
    const { status, error: message } = assignOwnerRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json(data, { status: 200 });
}
