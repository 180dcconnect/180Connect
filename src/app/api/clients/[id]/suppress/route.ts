import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { suppressionRpcFailure } from "@/lib/suppressions";

/**
 * F251 — the CAM-facing half of suppression, reached from /clients/[id] rather than
 * the admin workspace (/admin/suppressions, which covers the admin-facing half). Both
 * routes call the same request_suppression RPC; the RPC itself decides the outcome —
 * a CAM caller lands pending, an admin caller self-approves to active.
 */

const bodySchema = z.object({
  reason: z.string().trim().min(1, "Enter a reason for the suppression."),
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
      route: "/api/clients/[id]/suppress",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Enter a reason for the suppression." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("request_suppression", {
    p_organisation_id: organisationId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    await reportError(error, { operation: "clients.suppress", organisationId });
    const { status, error: message } = suppressionRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ id: data as string }, { status: 201 });
}
