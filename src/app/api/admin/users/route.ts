import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
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

/** Suspend (false) or reactivate (true) — F013. */
const accessUpdateSchema = z.object({
  userId: z.uuid(),
  isActive: z.boolean(),
});

const updateUserSchema = z.union([roleUpdateSchema, accessUpdateSchema]);

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
    .select("id, email, full_name, role, is_active, last_seen_at, created_at")
    .order("full_name", { ascending: true });

  if (error) {
    await reportError(error, { operation: "admin.users.list" });
    return NextResponse.json(
      { error: "Team members could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ users: data });
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

  return NextResponse.json({ user: data });
}
