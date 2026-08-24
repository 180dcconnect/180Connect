import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { PIPELINE_STATUSES } from "@/lib/organisation-format";
import { setOutreachStatusRpcFailure } from "@/lib/pipeline-status";
import { reportRescoreFailure, rescoreOrganisation } from "@/lib/scoring/rescore";

/**
 * F145 — change a client's pipeline status, reached from /clients/[id]. set_outreach_status
 * is SECURITY DEFINER, so authorization (owner CAM or admin) is re-checked inside it;
 * client:edit here is the same gate the claim and suppress routes use.
 */

const bodySchema = z.object({
  status: z.enum(PIPELINE_STATUSES),
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

  const { id: organisationId } = await params;
  if (!z.uuid().safeParse(organisationId).success) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 400 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/clients/[id]/status",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: "Choose a valid pipeline status." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_outreach_status", {
    p_organisation_id: organisationId,
    p_new_status: parsed.data.status,
  });

  if (error) {
    await reportError(error, { operation: "clients.status", organisationId });
    const { status, error: message } = setOutreachStatusRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  // F058/F059 AC2 — the pipeline status feeds the previous-contact factor, so a
  // status change changes the score. Refresh it in the same request: "re-sorting
  // after a score changes shows the new value" (#61) is only true if the change
  // is picked up here, not at the next backfill. Best-effort — see rescore.ts.
  await reportRescoreFailure(
    await rescoreOrganisation(organisationId),
    "clients.status.rescore",
    organisationId,
  );

  return NextResponse.json({ id: data as string }, { status: 200 });
}
