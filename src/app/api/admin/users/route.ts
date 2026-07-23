import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";

const updateUserSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["cam", "admin"]).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => value.role !== undefined || value.isActive !== undefined, {
  message: "Provide a role or active status to update.",
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
    .from("USERS")
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
      { error: "Choose a valid role or account status." },
      { status: 400 },
    );
  }

  if (
    parsed.data.userId === authorization.actor.id &&
    (parsed.data.isActive === false || parsed.data.role === "cam")
  ) {
    return NextResponse.json(
      { error: "You cannot remove access from your own administrator account." },
      { status: 400 },
    );
  }

  const changes = {
    ...(parsed.data.role ? { role: parsed.data.role } : {}),
    ...(parsed.data.isActive !== undefined
      ? { is_active: parsed.data.isActive }
      : {}),
    updated_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("USERS")
    .update(changes)
    .eq("id", parsed.data.userId)
    .select("id, email, full_name, role, is_active")
    .single();

  if (error) {
    await reportError(error, {
      operation: "admin.users.update",
      targetUserId: parsed.data.userId,
    });
    return NextResponse.json(
      { error: "The team member could not be updated. Please try again." },
      { status: 500 },
    );
  }

  console.info("[audit] admin.user_updated", {
    actorUserId: authorization.actor.id,
    targetUserId: parsed.data.userId,
    changedFields: Object.keys(changes).filter((key) => key !== "updated_at"),
  });

  return NextResponse.json({ user: data });
}
