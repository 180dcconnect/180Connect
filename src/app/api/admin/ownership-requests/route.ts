import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import {
  OWNERSHIP_REQUEST_SELECT,
  ownershipRequestRpcFailure,
  type OwnershipRequestRow,
} from "@/lib/ownership-requests";

/**
 * #408 — Request Client Ownership, admin side.
 *
 * GET    every request, all statuses, most recent first.
 * PATCH  approve or reject a pending one — decide_ownership_request. Approval is what
 *        moves the client, and it moves it through reassign_ownership inside the RPC,
 *        so the handover is audited like any other assignment.
 *
 * There is no POST here on purpose: an admin does not request a client from
 * themselves, they use F163's assign form. The CAM's request path is
 * /api/clients/[id]/request-ownership.
 */

const decideSchema = z.object({
  requestId: z.uuid(),
  approve: z.boolean(),
  note: z.string().trim().optional(),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/ownership-requests",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ownership_requests")
    .select(OWNERSHIP_REQUEST_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<OwnershipRequestRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.ownership_requests.list" });
    return NextResponse.json(
      { error: "The ownership requests could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ requests: data ?? [] });
}

export async function PATCH(request: Request) {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/ownership-requests",
  });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/ownership-requests",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the decision details." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("decide_ownership_request", {
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note || null,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.ownership_requests.decide",
      requestId: parsed.data.requestId,
    });
    const { status, error: message } = ownershipRequestRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
