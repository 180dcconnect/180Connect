import { NextResponse } from "next/server";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { assignActionFailure, validateAssignAction } from "@/lib/actions";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { createClient } from "@/lib/supabase/server";

/**
 * F169 — Admin-Assigned Actions.
 *
 * GET   every admin-assigned action across the team (RLS: all roles can read
 *       ACTIONS — actions_select_active, matrix §3.11 — this route narrows
 *       to "admin-assigned" the same way @/lib/actions's
 *       formatTeamAssignedActions does, client-side). AC3.
 * POST  create a new action and assign it to a CAM — a plain INSERT under
 *       actions_insert_admin (admin: any row, any column value; matrix §3.11
 *       already documents this as F169's own path). No RPC: unlike
 *       *reassigning* an existing action (F257's reason-carrying
 *       reassign_actions RPC), a fresh INSERT naming every column explicitly
 *       is not the "conditional/reason-carrying write" MIGRATIONS.md
 *       convention 4 reserves for RPCs. AC1.
 *
 * No audit_log entry: creating an action is a routine workflow write, not an
 * ownership/status/role/approval-state change (docs/audit-log-pattern.md §1)
 * — same reasoning NOTES and a CAM's own self-created ACTIONS row already
 * follow.
 */

const ACTION_SELECT =
  "id, title, description, due_date, status, organisation_id, created_by_user_id, assignee_user_id, created_at, " +
  "organisation:organisations!actions_organisation_id_fkey(legal_name), " +
  "created_by_user:users!actions_created_by_user_id_fkey(full_name), " +
  "assignee:users!actions_assignee_user_id_fkey(full_name)";

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET() {
  const authorization = await getCurrentActor("user:manage", { route: "/admin/actions" });
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("actions")
    .select(ACTION_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    await reportError(error, { operation: "admin.actions.list" });
    return NextResponse.json(
      { error: "Team actions could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ actions: data ?? [] });
}

export async function POST(request: Request) {
  const authorization = await getCurrentActor("user:manage", { route: "/admin/actions" });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const body = (input ?? {}) as Record<string, unknown>;
  const parsed = validateAssignAction({
    organisationId: body.organisationId,
    assigneeUserId: body.assigneeUserId,
    title: body.title,
    description: body.description,
    dueDate: body.dueDate,
  });

  if (!parsed.success) {
    logSecurityEvent("validation.rejected", { route: "/api/admin/actions" });
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("actions")
    .insert({
      organisation_id: parsed.data.organisationId,
      assignee_user_id: parsed.data.assigneeUserId,
      created_by_user_id: authorization.actor.id,
      title: parsed.data.title,
      description: parsed.data.description,
      due_date: parsed.data.dueDate,
    })
    .select("id")
    .single();

  if (error) {
    const failure = assignActionFailure(error);
    // Deliberate refusals (42501/23503/23514) are user-facing messages, not
    // incidents; anything else is an unexpected failure worth ERROR_LOG.
    if (failure.status === 500) {
      await reportError(error, {
        operation: "admin.actions.assign",
        actorUserId: authorization.actor.id,
        organisationId: parsed.data.organisationId,
        assigneeUserId: parsed.data.assigneeUserId,
      });
    }
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
