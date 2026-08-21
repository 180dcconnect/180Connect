import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import {
  SUPPRESSION_SELECT,
  suppressionRpcFailure,
  type SuppressionRow,
} from "@/lib/suppressions";

/**
 * F251 — Suppress Charity Record.
 *
 * GET    list every suppression (all statuses), most recent first.
 * POST   an admin suppresses a charity directly — request_suppression self-approves
 *        for an admin caller, landing straight on 'active' (see the RPC).
 * PATCH  approve or reject a pending request — decide_suppression_request.
 *
 * Admin-only route (approval:manage). A CAM's own request path is not wired up here
 * yet — there is no client detail page to host it from (F067, not built) — but the
 * RPC itself already accepts a CAM caller and lands the row 'pending'; this route
 * only ever calls it as the signed-in admin.
 */

const createSchema = z.object({
  organisationId: z.uuid(),
  reason: z.string().trim().min(1, "Enter a reason for the suppression."),
});

const liftSchema = z.object({
  action: z.literal("lift"),
  suppressionId: z.uuid(),
  reason: z.string().trim().min(1, "Enter a reason for lifting the suppression."),
});

const decideSchema = z.object({
  action: z.literal("decide").optional(),
  suppressionId: z.uuid(),
  approve: z.boolean(),
  note: z.string().trim().optional(),
});

const patchSchema = z.union([liftSchema, decideSchema]);

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/suppressions",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("suppressions")
    .select(SUPPRESSION_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<SuppressionRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.suppressions.list" });
    return NextResponse.json(
      { error: "The suppression list could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ suppressions: data ?? [] });
}

export async function POST(request: Request) {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/suppressions",
  });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/suppressions",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the suppression details." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("request_suppression", {
    p_organisation_id: parsed.data.organisationId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.suppressions.request",
      organisationId: parsed.data.organisationId,
    });
    const { status, error: message } = suppressionRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ id: data as string }, { status: 201 });
}

export async function PATCH(request: Request) {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/suppressions",
  });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/suppressions",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the suppression details." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  if ("action" in parsed.data && parsed.data.action === "lift") {
    const { error } = await supabase.rpc("lift_suppression", {
      p_suppression_id: parsed.data.suppressionId,
      p_reason: parsed.data.reason,
    });

    if (error) {
      await reportError(error, {
        operation: "admin.suppressions.lift",
        suppressionId: parsed.data.suppressionId,
      });
      const { status, error: message } = suppressionRpcFailure(error);
      return NextResponse.json({ error: message }, { status });
    }

    return NextResponse.json({ ok: true, lifted: true });
  }

  const { error } = await supabase.rpc("decide_suppression_request", {
    p_suppression_id: parsed.data.suppressionId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note || null,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.suppressions.decide",
      suppressionId: parsed.data.suppressionId,
    });
    const { status, error: message } = suppressionRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
