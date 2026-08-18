import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { claimOwnershipRpcFailure } from "@/lib/ownership";
import { ownershipClaimConflictMessage } from "@/lib/outreach/ownership-conflict";

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

    // F165 AC2: the RPC's 409 only says "already owned by another CAM". Resolve the
    // owner so the CAM is told who to go to. A failed lookup keeps the RPC's wording
    // rather than blocking — the claim is already refused either way.
    if (status === 409) {
      const { data: ownerRow, error: ownerError } = await supabase
        .from("organisations")
        .select("owner:users!organisations_owner_id_fkey(full_name)")
        .eq("id", organisationId)
        .maybeSingle<{ owner: { full_name: string | null } | null }>();
      if (ownerError) {
        await reportError(ownerError, { operation: "clients.claim.owner_lookup", organisationId });
      } else {
        return NextResponse.json(
          { error: ownershipClaimConflictMessage(ownerRow?.owner?.full_name ?? null) },
          { status },
        );
      }
    }

    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ id: data as string }, { status: 200 });
}
