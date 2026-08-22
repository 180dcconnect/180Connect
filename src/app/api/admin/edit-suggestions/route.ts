import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  EDIT_SUGGESTION_SELECT,
  decideEditRpcFailure,
  type EditSuggestionRow,
} from "@/lib/edit-suggestions";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { createClient } from "@/lib/supabase/server";

/**
 * #80/#81 — Approve/Reject Client Edit, admin side.
 *
 * GET    every suggestion the admin can see (RLS: all rows), most recent first.
 * PATCH  approve or reject a pending one — decide_edit_suggestion. Approval is what
 *        applies the value to organisations, inside the RPC, after its
 *        stale-snapshot guard; both branches audit in the same transaction.
 *
 * There is no POST: suggestions are created by CAMs through suggestEditAction on the
 * client profile. This route only decides them.
 */

const decideSchema = z.object({
  suggestionId: z.uuid(),
  approve: z.boolean(),
  reason: z.string().trim().optional(),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/edit-suggestions",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("edit_suggestions")
    .select(EDIT_SUGGESTION_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<EditSuggestionRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.edit_suggestions.list" });
    return NextResponse.json(
      { error: "The suggested edits could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ suggestions: data ?? [] });
}

export async function PATCH(request: Request) {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/api/admin/edit-suggestions",
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
      route: "/api/admin/edit-suggestions",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the decision details." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("decide_edit_suggestion", {
    p_suggestion_id: parsed.data.suggestionId,
    p_approve: parsed.data.approve,
    p_reason: parsed.data.reason || null,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.edit_suggestions.decide",
      actorUserId: authorization.actor.id,
      suggestionId: parsed.data.suggestionId,
    });
    const { status, error: message } = decideEditRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
