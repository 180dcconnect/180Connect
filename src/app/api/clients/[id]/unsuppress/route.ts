import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { suppressionRpcFailure } from "@/lib/suppressions";

/**
 * F185 — Admin unsuppresses a charity record. Reverses F251/F248.
 * Reached from /clients/[id] by an admin.
 * Requires a mandatory written reason.
 */

const bodySchema = z.object({
  reason: z.string().trim().min(1, "Enter a reason for lifting the suppression."),
  suppressionId: z.uuid().optional(),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("approval:manage", { route: "/clients/[id]" });
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
      route: "/api/clients/[id]/unsuppress",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Enter a reason for lifting the suppression." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  let targetSuppressionId = parsed.data.suppressionId;

  if (!targetSuppressionId) {
    const { data: activeSuppression, error: lookupError } = await supabase
      .from("suppressions")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("status", "active")
      .maybeSingle<{ id: string }>();

    if (lookupError || !activeSuppression) {
      return NextResponse.json(
        { error: "No active suppression found for this charity." },
        { status: 404 },
      );
    }
    targetSuppressionId = activeSuppression.id;
  }

  const { error } = await supabase.rpc("lift_suppression", {
    p_suppression_id: targetSuppressionId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    await reportError(error, {
      operation: "clients.unsuppress",
      organisationId,
      suppressionId: targetSuppressionId,
    });
    const { status, error: message } = suppressionRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true, lifted: true });
}
