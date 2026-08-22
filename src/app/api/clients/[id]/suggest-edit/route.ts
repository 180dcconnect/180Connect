import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { clientEditSuggestionRpcFailure, SUGGESTIBLE_FIELDS } from "@/lib/client-edit-suggestions";

/**
 * F077 — a CAM proposes a correction to one of the six canonical client fields.
 *
 * This route creates a *suggestion*. It changes nothing on `organisations`:
 * `suggest_client_edit` is `SECURITY DEFINER` and inserts a pending row, snapshotting
 * the field's current value for later comparison (AC2). Approving or rejecting one is
 * F078/F079 — not built yet, so every suggestion this route creates stays pending.
 *
 * `client:edit` is the gate, same permission BasicInfoPanel's data is read under —
 * this is the CAM-facing route to changing that data. The RPC re-checks
 * `app.can_write()` itself.
 */

const FIELD_NAMES = SUGGESTIBLE_FIELDS.map((field) => field.fieldName) as [string, ...string[]];

const Body = z.object({
  fieldName: z.enum(FIELD_NAMES),
  proposedValue: z
    .string()
    .trim()
    .min(1, "Enter the corrected value before sending the suggestion."),
  note: z.string().trim().max(2000).optional(),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("client:edit", {
    route: "/api/clients/[id]/suggest-edit",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId } = await params;
  if (!z.uuid().safeParse(organisationId).success) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 400 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/clients/[id]/suggest-edit",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the suggested edit and try again." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("suggest_client_edit", {
    p_organisation_id: organisationId,
    p_field_name: parsed.data.fieldName,
    p_proposed_value: parsed.data.proposedValue,
    p_note: parsed.data.note ?? null,
  });

  if (error) {
    await reportError(error, { operation: "clients.suggest_edit", organisationId });
    const { status, error: message } = clientEditSuggestionRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ id: data as string }, { status: 201 });
}
