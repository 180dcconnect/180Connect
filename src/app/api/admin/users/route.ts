import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  accountChangeFailureMessage,
  accountChangeFailureStatus,
} from "@/lib/auth/account-changes";
import { canChangeAccess, canChangeRole } from "@/lib/auth/permissions";
import { logRoleChangeDenial, roleFailureMessage } from "@/lib/auth/permission-denial";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";

const roleUpdateSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["cam", "admin", "viewer"]),
});

const reactivateSchema = z.object({
  userId: z.uuid(),
  isActive: z.literal(true),
});

/**
 * Suspend, optionally handing the member's clients and open actions on in the same
 * transaction. `reassignTo` and `releaseClients` are both absent for a plain
 * suspension; a reason is only required — by the database — when work moves.
 */
const suspendSchema = z.object({
  userId: z.uuid(),
  isActive: z.literal(false),
  reason: z.string().trim().max(500).optional(),
  reassignTo: z.uuid().optional(),
  releaseClients: z.boolean().optional(),
});

const updateUserSchema = z.union([roleUpdateSchema, reactivateSchema, suspendSchema]);

/**
 * Delete. Irreversible: the database either removes the account outright or, when it
 * has history, redacts it. The admin must say where owned clients go; the database is
 * what decides whether that was required, since it is the only party that can count the
 * rows without a race.
 */
const deleteSchema = z.object({
  userId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  reassignTo: z.uuid().optional(),
  releaseClients: z.boolean().optional(),
});

/** Reactivation's refusals — suspension and deletion go through account-changes.ts. */
function reactivateFailureMessage(hint: string | null | undefined): string {
  switch (hint) {
    case "not_admin":
      return "Only an admin can change a team member's access.";
    case "user_deleted":
      return "A deleted account cannot be reactivated.";
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

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false };
  }
}

export async function GET() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active, last_seen_at, created_at")
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  if (error) {
    await reportError(error, { operation: "admin.users.list" });
    return NextResponse.json(
      { error: "Team members could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  // How many clients each member owns, so the table can warn before an admin starts a
  // deletion that the gate will refuse. Counted here rather than trusted as the
  // decision: delete_user recounts inside its own transaction, which is the only place
  // immune to a client being reassigned between this read and that write.
  const { data: owned, error: ownedError } = await supabase
    .from("organisations")
    .select("id, owner_id")
    .not("owner_id", "is", null);

  if (ownedError) {
    // Non-fatal. Without the counts the table still lists everyone and deletion still
    // works — the admin just meets the gate at the point of pressing the button.
    await reportError(ownedError, { operation: "admin.users.owned_client_counts" });
  }

  // F167: the table's Clients column links to /clients?owner=, which never lists an
  // actively-suppressed client (F051 AC4), so that column counts the listed subset
  // while the deletion gate above keeps counting everything the member owns.
  const { data: suppressed, error: suppressedError } = await supabase
    .from("suppressions")
    .select("organisation_id")
    .eq("status", "active");

  if (suppressedError) {
    await reportError(suppressedError, { operation: "admin.users.suppressed_clients" });
  }

  const suppressedOrgs = new Set((suppressed ?? []).map((row) => row.organisation_id));

  const ownedCounts = new Map<string, number>();
  const listedCounts = new Map<string, number>();
  for (const row of owned ?? []) {
    if (!row.owner_id) continue;
    ownedCounts.set(row.owner_id, (ownedCounts.get(row.owner_id) ?? 0) + 1);
    if (!suppressedOrgs.has(row.id)) {
      listedCounts.set(row.owner_id, (listedCounts.get(row.owner_id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    users: (data ?? []).map((user) => ({
      ...user,
      owned_client_count: ownedCounts.get(user.id) ?? 0,
      listed_client_count: listedCounts.get(user.id) ?? 0,
    })),
    ownedCountsAvailable: !ownedError,
  });
}

export async function PATCH(request: Request) {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) return denied(authorization.reason);

  const body = await readJson(request);
  if (!body.ok) {
    return NextResponse.json(
      { error: "The request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = updateUserSchema.safeParse(body.value);
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
  // How many clients a suspension handed on, so the confirmation can name the number.
  let clientsMoved = 0;

  if ("role" in parsed.data) {
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

      // A blocked write is one of the two "observable" denial cases (matrix §4)
      // and must leave its own record — set_user_role only writes audit_log on
      // success. authenticated has no INSERT grant on audit_log (by design, so a
      // client can never forge an entry), so this goes through the service-role
      // client, the other writer audit_log's own migration names as legitimate.
      if (roleError.code === "42501") {
        const admin = createAdminClient();
        const { error: denialLogError } = await logRoleChangeDenial(admin, {
          actorId: authorization.actor.id,
          targetUserId: parsed.data.userId,
          attemptedRole: parsed.data.role,
          reason: roleError.message,
        });
        if (denialLogError) {
          await reportError(denialLogError, {
            operation: "admin.users.log_role_denial",
            targetUserId: parsed.data.userId,
          });
        }
      }

      return NextResponse.json(
        { error: roleFailureMessage(roleError) },
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

    if (parsed.data.isActive) {
      const { error: accessError } = await supabase.rpc("set_user_active", {
        p_user_id: parsed.data.userId,
        p_is_active: true,
      });

      if (accessError) {
        await reportError(accessError, {
          operation: "admin.users.reactivate",
          targetUserId: parsed.data.userId,
        });
        return NextResponse.json(
          { error: reactivateFailureMessage(accessError.hint) },
          { status: accountChangeFailureStatus(accessError.code, accessError.hint) },
        );
      }
    } else {
      // Nothing follows the RPC. Revoking sessions, the handover and the audit rows are
      // all part of suspend_user's transaction, so it either all happened or none did.
      const { data: result, error: suspendError } = await supabase.rpc("suspend_user", {
        p_user_id: parsed.data.userId,
        p_reason: parsed.data.reason ?? null,
        p_reassign_to: parsed.data.reassignTo ?? null,
        p_release_clients: parsed.data.releaseClients ?? false,
      });

      if (suspendError) {
        await reportError(suspendError, {
          operation: "admin.users.suspend",
          targetUserId: parsed.data.userId,
        });
        return NextResponse.json(
          {
            error: accountChangeFailureMessage("suspend", suspendError.hint),
            hint: suspendError.hint ?? undefined,
          },
          { status: accountChangeFailureStatus(suspendError.code, suspendError.hint) },
        );
      }

      clientsMoved = (result as { clients_moved?: number } | null)?.clients_moved ?? 0;
    }
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active")
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

  return NextResponse.json({
    user: data,
    ...(clientsMoved > 0 ? { clientsMoved } : {}),
  });
}

export async function DELETE(request: Request) {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) return denied(authorization.reason);

  const body = await readJson(request);
  if (!body.ok) {
    return NextResponse.json(
      { error: "The request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = deleteSchema.safeParse(body.value);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/users",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: "Give a reason for deleting this team member." },
      { status: 400 },
    );
  }

  if (!canChangeAccess(authorization.actor.id, parsed.data.userId).ok) {
    return NextResponse.json(
      { error: accountChangeFailureMessage("delete", "self_access_change") },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: result, error: deleteError } = await supabase.rpc("delete_user", {
    p_user_id: parsed.data.userId,
    p_reason: parsed.data.reason,
    p_reassign_to: parsed.data.reassignTo ?? null,
    p_release_clients: parsed.data.releaseClients ?? false,
  });

  if (deleteError) {
    // owns_active_clients is the reassignment gate doing its job, not a failure, so it
    // is not reported as an error.
    if (deleteError.hint !== "owns_active_clients") {
      await reportError(deleteError, {
        operation: "admin.users.delete",
        targetUserId: parsed.data.userId,
      });
    }
    return NextResponse.json(
      {
        error: accountChangeFailureMessage("delete", deleteError.hint),
        hint: deleteError.hint ?? undefined,
      },
      { status: accountChangeFailureStatus(deleteError.code, deleteError.hint) },
    );
  }

  const outcome = result as {
    mode?: "deleted" | "redacted";
    clients_moved?: number;
    actions_moved?: number;
  } | null;

  return NextResponse.json({
    mode: outcome?.mode ?? "deleted",
    clientsMoved: outcome?.clients_moved ?? 0,
    actionsMoved: outcome?.actions_moved ?? 0,
  });
}
