import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { canChangeAccess, canChangeRole } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { revokeUserSessions } from "@/lib/supabase/admin";
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
  // Set when a suspension landed but its session sweep did not, so the admin is told
  // the account is blocked from the data even though a stale token may still resolve.
  let warning: string | undefined;

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

    // Order matters. The flag is flipped first, so every RLS policy already denies
    // this user before we touch their sessions; if the sweep then fails they are
    // locked out of all data regardless, and only the token shell survives. Doing it
    // the other way round would leave a window where they are signed out but still
    // permitted, and could simply sign back in.
    if (!parsed.data.isActive) {
      const revoked = await revokeUserSessions(parsed.data.userId);
      if (!revoked.ok) {
        await reportError(revoked.error, {
          operation: "admin.users.revoke_sessions",
          targetUserId: parsed.data.userId,
        });
        warning =
          "The account is suspended and blocked from all data, but its existing sign-in could not be revoked and may persist until it expires.";
      }
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

  return NextResponse.json(warning ? { user: data, warning } : { user: data });
}
