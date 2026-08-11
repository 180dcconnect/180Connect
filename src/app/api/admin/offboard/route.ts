import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import {
  rpcFailureResponse,
  summariseHoldings,
  type OpenActionRow,
  type OwnedOrganisation,
} from "@/lib/offboard";

/**
 * F257 — Reassign CAM When Offboarded.
 *
 * GET  ?userId=…  what the outgoing CAM is holding, so the admin can see the size of
 *                 the handover before committing to it.
 * POST            performs it, through the two audited RPCs.
 *
 * The client never sends the list of things to move. It sends who is leaving, who is
 * taking over, and why; the server re-resolves the work at the moment of the write.
 * A client-supplied id list would be a stale snapshot at best and an admin-authenticated
 * way to move arbitrary clients at worst.
 */

const previewSchema = z.object({ userId: z.uuid() });

const offboardSchema = z.object({
  fromUserId: z.uuid(),
  toUserId: z.uuid(),
  // The RPC rejects a blank reason too. Checking here as well turns it into a field
  // error the admin can fix rather than a round-trip that reads as a server fault.
  reason: z.string().trim().min(1, "Enter a reason for the handover."),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET(request: Request) {
  const authorization = await getCurrentActor("ownership:reassign");
  if (!authorization.ok) return denied(authorization.reason);

  const parsed = previewSchema.safeParse({
    userId: new URL(request.url).searchParams.get("userId"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a team member to review." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const [organisations, actions] = await Promise.all([
    supabase
      .from("organisations")
      .select("id, legal_name")
      .eq("owner_id", parsed.data.userId)
      .order("legal_name"),
    supabase
      .from("actions")
      .select("id, title, organisation_id, organisations(legal_name)")
      .eq("assignee_user_id", parsed.data.userId)
      .eq("status", "open")
      .order("due_date", { nullsFirst: false }),
  ]);

  if (organisations.error || actions.error) {
    await reportError(organisations.error ?? actions.error, {
      operation: "admin.offboard.preview",
      targetUserId: parsed.data.userId,
    });
    return NextResponse.json(
      { error: "That team member's work could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    summariseHoldings(
      (organisations.data ?? []) as OwnedOrganisation[],
      (actions.data ?? []) as unknown as OpenActionRow[],
    ),
  );
}

export async function POST(request: Request) {
  const authorization = await getCurrentActor("ownership:reassign");
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = offboardSchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/offboard",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the handover details." },
      { status: 400 },
    );
  }

  const { fromUserId, toUserId, reason } = parsed.data;

  if (fromUserId === toUserId) {
    return NextResponse.json(
      { error: "Choose a different person to take the work over." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const owned = await supabase
    .from("organisations")
    .select("id")
    .eq("owner_id", fromUserId);

  if (owned.error) {
    await reportError(owned.error, {
      operation: "admin.offboard.resolve_clients",
      targetUserId: fromUserId,
    });
    return NextResponse.json(
      { error: "The handover could not be prepared. Please try again." },
      { status: 500 },
    );
  }

  const organisationIds = (owned.data ?? []).map((row) => row.id);
  let organisationsMoved = 0;
  let actionsMoved = 0;
  let skipped = 0;

  if (organisationIds.length > 0) {
    const { data, error } = await supabase.rpc("reassign_ownership", {
      p_organisation_ids: organisationIds,
      p_new_owner_id: toUserId,
      p_reason: reason,
      p_from_user_id: fromUserId,
    });

    if (error) return rpcFailure(error, "admin.offboard.reassign_ownership", fromUserId);

    const summary = data as {
      organisations_moved: number;
      actions_moved: number;
      skipped: number;
    };
    organisationsMoved = summary.organisations_moved;
    actionsMoved = summary.actions_moved;
    skipped = summary.skipped;
  }

  // Re-read rather than reusing the preview: the call above has just moved every open
  // action that travelled with a client, so what is left is exactly the cross-client
  // work — without a second query this would try to move them twice.
  const remaining = await supabase
    .from("actions")
    .select("id")
    .eq("assignee_user_id", fromUserId)
    .eq("status", "open");

  if (remaining.error) {
    await reportError(remaining.error, {
      operation: "admin.offboard.resolve_actions",
      targetUserId: fromUserId,
    });
    // The ownership half has already committed. Report the partial result honestly
    // instead of a bare 500 that would invite the admin to run the whole thing again.
    return NextResponse.json(
      {
        error:
          "The clients were reassigned, but the remaining actions could not be read. "
          + "Re-run the handover to finish moving them.",
        organisationsMoved,
        actionsMoved,
        skipped,
      },
      { status: 500 },
    );
  }

  const remainingIds = (remaining.data ?? []).map((row) => row.id);

  if (remainingIds.length > 0) {
    const { data, error } = await supabase.rpc("reassign_actions", {
      p_action_ids: remainingIds,
      p_new_assignee_id: toUserId,
      p_reason: reason,
    });

    if (error) return rpcFailure(error, "admin.offboard.reassign_actions", fromUserId);

    const summary = data as { actions_moved: number; skipped: number };
    actionsMoved += summary.actions_moved;
    skipped += summary.skipped;
  }

  return NextResponse.json({ organisationsMoved, actionsMoved, skipped });
}

/** Records the failure, then renders the safe version of it (see @/lib/offboard). */
async function rpcFailure(
  error: { code?: string; message?: string },
  operation: string,
  targetUserId: string,
) {
  await reportError(error, { operation, targetUserId });
  const { status, error: message } = rpcFailureResponse(error);
  return NextResponse.json({ error: message }, { status });
}
