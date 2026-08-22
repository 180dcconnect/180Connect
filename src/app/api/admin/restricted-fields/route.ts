import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  restrictedFieldRpcFailure,
  validateRestrictedFieldInput,
  type RestrictedFieldRow,
} from "@/lib/edit-suggestions";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { createClient } from "@/lib/supabase/server";

/**
 * #23 (F020) — Restricted-field configuration, admin side.
 *
 * GET     every configuration row (RLS: admins see all, retired ones included).
 * POST    restrict a client field — add_restricted_edit_field (audited). Takes
 *         effect immediately: the organisations column-guard trigger reads the same
 *         table.
 * DELETE  retire a restriction (soft-disable, audited) — the row stays so historical
 *         suggestions keep their FK and the trail of what was restricted survives.
 */

const deactivateSchema = z.object({
  fieldName: z.string().trim().min(1),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/restricted-fields",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("restricted_edit_fields")
    .select("field_name, reason, active")
    .order("active", { ascending: false })
    .order("field_name")
    .overrideTypes<RestrictedFieldRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.restricted_fields.list" });
    return NextResponse.json(
      { error: "The restricted fields could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ fields: data ?? [] });
}

export async function POST(request: Request) {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/api/admin/restricted-fields",
  });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = validateRestrictedFieldInput({
    fieldName: (input as { fieldName?: unknown })?.fieldName,
    reason: (input as { reason?: unknown })?.reason,
  });
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/restricted-fields",
      fieldCount: 1,
    });
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("add_restricted_edit_field", {
    p_field_name: parsed.data.fieldName,
    p_reason: parsed.data.reason,
  });

  if (error) {
    const failure = restrictedFieldRpcFailure(error);
    if (failure.status === 500) {
      await reportError(error, {
        operation: "admin.restricted_fields.add",
        actorUserId: authorization.actor.id,
        fieldName: parsed.data.fieldName,
      });
    }
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/api/admin/restricted-fields",
  });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = deactivateSchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/restricted-fields",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the request." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("deactivate_restricted_edit_field", {
    p_field_name: parsed.data.fieldName,
  });

  if (error) {
    const failure = restrictedFieldRpcFailure(error);
    if (failure.status === 500) {
      await reportError(error, {
        operation: "admin.restricted_fields.deactivate",
        actorUserId: authorization.actor.id,
        fieldName: parsed.data.fieldName,
      });
    }
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }

  return NextResponse.json({ ok: true });
}
