import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { ownershipRequestRpcFailure } from "@/lib/ownership-requests";

/**
 * #408 — a CAM asks an admin to hand over a client another CAM owns, from the
 * ownership conflict warning on /clients/[id] (F165).
 *
 * This route creates a *request*. It moves no ownership and grants the caller no
 * access: request_client_ownership is SECURITY DEFINER and inserts a pending row,
 * nothing more. Approving it is /api/admin/ownership-requests, admin only.
 *
 * client:contact rather than client:edit is the gate: this is the escalation path off
 * the outreach conflict warning, so the people who can reach it are exactly the people
 * who could have tried to contact the client. The RPC re-checks app.is_cam() itself.
 */

const Body = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required so the admin can decide on the handover."),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("client:contact", {
    route: "/api/clients/[id]/request-ownership",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId } = await params;
  if (!z.uuid().safeParse(organisationId).success) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 400 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/clients/[id]/request-ownership",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Give a reason for the request." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("request_client_ownership", {
    p_organisation_id: organisationId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    await reportError(error, { operation: "clients.request_ownership", organisationId });
    const { status, error: message } = ownershipRequestRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ id: data as string }, { status: 201 });
}
