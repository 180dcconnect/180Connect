import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import {
  FIELD_DISCREPANCY_SELECT,
  discrepancyRpcFailure,
  type FieldDiscrepancyRow,
} from "@/lib/discrepancies";

/**
 * F048 — Data Discrepancy Detection, admin review queue.
 *
 * GET   list every field discrepancy (all statuses), most recent first. Rows are
 *       written by record_field_discrepancy, a follow-up to /api/admin/duplicates
 *       confirming a cross-source match — never by this route.
 * PATCH resolve a pending discrepancy — resolve_field_discrepancy.
 *
 * Admin-only route (approval:manage — same permission the duplicates queue uses).
 */

const resolveSchema = z.object({
  fieldDiscrepancyId: z.uuid(),
  choice: z.enum(["existing", "incoming"]),
  note: z.string().trim().optional(),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/discrepancies",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("field_discrepancies")
    .select(FIELD_DISCREPANCY_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<FieldDiscrepancyRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.discrepancies.list" });
    return NextResponse.json(
      { error: "The discrepancies list could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ discrepancies: data ?? [] });
}

export async function PATCH(request: Request) {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/discrepancies",
  });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/discrepancies",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the decision details." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("resolve_field_discrepancy", {
    p_field_discrepancy_id: parsed.data.fieldDiscrepancyId,
    p_choice: parsed.data.choice,
    p_note: parsed.data.note || null,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.discrepancies.resolve",
      fieldDiscrepancyId: parsed.data.fieldDiscrepancyId,
    });
    const { status, error: message } = discrepancyRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
