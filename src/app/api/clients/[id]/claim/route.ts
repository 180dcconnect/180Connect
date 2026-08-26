import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { claimOwnershipRpcFailure } from "@/lib/ownership";

/**
 * F162 — take ownership of a client, reached from both /clients (the list) and
 * /clients/[id] (the profile) via the same ClaimButton. claim_organisation is
 * SECURITY DEFINER, so authorization is re-checked inside it; client:edit here is
 * the same gate the suppress route uses (excludes viewers before the RPC round trip).
 */

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId } = await params;
  if (!z.uuid().safeParse(organisationId).success) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("claim_organisation", {
    p_organisation_id: organisationId,
  });

  if (error) {
    await reportError(error, { operation: "clients.claim", organisationId });
    const { status, error: message } = claimOwnershipRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ id: data as string }, { status: 200 });
}
