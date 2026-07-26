import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { canChangeRole } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";

const updateUserSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["cam", "admin", "viewer"]),
});

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
      { error: "Choose a valid CAM, Admin, or Viewer role." },
      { status: 400 },
    );
  }

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

  const supabase = await createClient();
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

  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active")
    .eq("id", parsed.data.userId)
    .single();

  if (error) {
    await reportError(error, {
      operation: "admin.users.read_updated_role",
      targetUserId: parsed.data.userId,
    });
    return NextResponse.json(
      { error: "The team member could not be updated. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ user: data });
}
