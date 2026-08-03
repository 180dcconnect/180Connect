import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  deactivationFailureMessage,
  deactivationFailureStatus,
} from "@/lib/auth/deactivation";
import { canChangeAccess, canChangeRole } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";

const roleUpdateSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["cam", "admin", "viewer"]),
});

/** Suspend (false) or reactivate (true) — F013. */
const accessUpdateSchema = z.object({
  userId: z.uuid(),
  isActive: z.boolean(),
});

/**
 * Deactivate (offboard) — F014. `deactivate: true` is a literal rather than a boolean
 * because there is no such thing as `deactivate: false`: the reverse of deactivation is
 * reactivation, which is `{ isActive: true }` through the F013 path.
 *
 * `reassignTo` and `releaseClients` are the two destinations PRD §6.12 allows for the
 * departing user's clients. Both may be absent when the user owns nothing; the database
 * is what decides whether one was required, since it is the only party that can count
 * the rows without a race.
 */
const deactivateSchema = z.object({
  userId: z.uuid(),
  deactivate: z.literal(true),
  reason: z.string().trim().min(1).max(500),
  reassignTo: z.uuid().optional(),
  releaseClients: z.boolean().optional(),
});

/**
 * Deactivation is matched first. Zod objects ignore unknown keys, so a body carrying
 * both `deactivate` and `isActive` would otherwise be read as a plain suspension and
 * silently skip the offboarding.
 */
const updateUserSchema = z.union([
  deactivateSchema,
  roleUpdateSchema,
  accessUpdateSchema,
]);

/**
 * `set_user_active` raises 42501 for two different reasons and attaches a HINT to tell
 * them apart. Switching on the hint rather than the message means rewording an
 * exception in the migration cannot silently change what the admin reads here.
 */
function accessFailureMessage(hint: string | null | undefined): string {
  switch (hint) {
    case "self_access_change":
      return "You cannot suspend your own account.";
    case "not_admin":
      return "Only an admin can change a team member's access.";
    default:
      return "The access change was blocked. Refresh and try again.";
  }
}

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json(
    { error: actorFailureMessage(reason) },
    { status },
  );
}

export async function GET() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, email, full_name, role, is_active, deactivated_at, last_seen_at, created_at",
    )
    .order("full_name", { ascending: true });

  if (error) {
    await reportError(error, { operation: "admin.users.list" });
    return NextResponse.json(
      { error: "Team members could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  // How many clients each member owns, so the table can warn before an admin starts a
  // deactivation that the gate will refuse (F014 AC2). Counted here rather than trusted
  // as the decision: deactivate_user recounts inside its own transaction, which is the
  // only place immune to a client being reassigned between this read and that write.
  const { data: owned, error: ownedError } = await supabase
    .from("organisations")
    .select("owner_id")
    .not("owner_id", "is", null);

  if (ownedError) {
    // Non-fatal. Without the counts the table still lists everyone and deactivation
    // still works — the admin just meets the gate at the point of pressing the button
    // instead of seeing it coming.
    await reportError(ownedError, { operation: "admin.users.owned_client_counts" });
  }

  const ownedCounts = new Map<string, number>();
  for (const row of owned ?? []) {
    if (!row.owner_id) continue;
    ownedCounts.set(row.owner_id, (ownedCounts.get(row.owner_id) ?? 0) + 1);
  }

  return NextResponse.json({
    users: (data ?? []).map((user) => ({
      ...user,
      owned_client_count: ownedCounts.get(user.id) ?? 0,
    })),
    ownedCountsAvailable: !ownedError,
  });
}

export async function PATCH(request: Request) {
  const authorization = await getCurrentActor("user:manage");
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

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/users",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: "Choose a valid CAM, Admin, or Viewer role, or a valid access change." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  // How many clients the deactivation moved, so the confirmation can name the number.
  let clientsMoved = 0;

  if ("deactivate" in parsed.data) {
    const accessChange = canChangeAccess(
      authorization.actor.id,
      parsed.data.userId,
    );
    if (!accessChange.ok) {
      return NextResponse.json(
        { error: "You cannot deactivate your own account." },
        { status: 400 },
      );
    }

    const { data: result, error: deactivateError } = await supabase.rpc(
      "deactivate_user",
      {
        p_user_id: parsed.data.userId,
        p_reason: parsed.data.reason,
        p_reassign_to: parsed.data.reassignTo ?? null,
        p_release_clients: parsed.data.releaseClients ?? false,
      },
    );

    if (deactivateError) {
      // owns_active_clients is the reassignment gate doing its job, not a failure, so
      // it is not reported as an error — it would otherwise fill ERROR_LOG with the
      // normal first half of every offboarding.
      if (deactivateError.hint !== "owns_active_clients") {
        await reportError(deactivateError, {
          operation: "admin.users.deactivate",
          targetUserId: parsed.data.userId,
        });
      }
      return NextResponse.json(
        {
          error: deactivationFailureMessage(deactivateError.hint),
          hint: deactivateError.hint ?? undefined,
        },
        {
          status: deactivationFailureStatus(
            deactivateError.code,
            deactivateError.hint,
          ),
        },
      );
    }

    clientsMoved = (result as { clients_moved?: number } | null)?.clients_moved ?? 0;

    // Nothing follows the RPC. Signing the user out is part of its transaction, the
    // same as for a suspension, so the reassignment, the account closing and the
    // session revocation all commit together or none of them do.
  } else if ("role" in parsed.data) {
    const roleChange = canChangeRole(
      authorization.actor.id,
      parsed.data.userId,
    );
    if (!roleChange.ok) {
      return NextResponse.json(
        { error: roleChange.message },
        { status: 400 },
      );
    }

    const { error: roleError } = await supabase.rpc("set_user_role", {
      p_user_id: parsed.data.userId,
      p_new_role: parsed.data.role,
    });

    if (roleError) {
      await reportError(roleError, {
        operation: "admin.users.set_role",
        targetUserId: parsed.data.userId,
      });
      return NextResponse.json(
        { error: "The role change was blocked. Refresh and try again." },
        { status: roleError.code === "42501" ? 403 : 500 },
      );
    }
  } else {
    const accessChange = canChangeAccess(
      authorization.actor.id,
      parsed.data.userId,
    );
    if (!accessChange.ok) {
      return NextResponse.json(
        { error: accessChange.message },
        { status: 400 },
      );
    }

    const { error: accessError } = await supabase.rpc("set_user_active", {
      p_user_id: parsed.data.userId,
      p_is_active: parsed.data.isActive,
    });

    if (accessError) {
      await reportError(accessError, {
        operation: "admin.users.set_active",
        targetUserId: parsed.data.userId,
      });
      return NextResponse.json(
        { error: accessFailureMessage(accessError.hint) },
        { status: accessError.code === "42501" ? 403 : 500 },
      );
    }

    // No logSecurityEvent here: set_user_active writes an audit_log row in the same
    // transaction as the change, which is the durable record. This module is for
    // failures that leave no other trace.
    //
    // Nothing follows the RPC. Revoking the suspended user's sessions used to be a
    // second step here, with a warning for when it failed; it is now part of
    // set_user_active's transaction, so it either happened or the suspension did not.
    // There is no longer a half-suspended state for the route to describe.
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active, deactivated_at")
    .eq("id", parsed.data.userId)
    .single();

  if (error) {
    await reportError(error, {
      operation: "admin.users.read_updated_row",
      targetUserId: parsed.data.userId,
    });
    return NextResponse.json(
      { error: "The team member could not be updated. Please try again." },
      { status: 500 },
    );
  }

  // clientsMoved is only ever non-zero on the deactivation path; the table uses it to
  // confirm the handover by number rather than making the admin go and check.
  return NextResponse.json({
    user: data,
    ...(clientsMoved > 0 ? { clientsMoved } : {}),
  });
}
