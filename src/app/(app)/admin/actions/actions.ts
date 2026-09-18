"use server";

import { revalidatePath } from "next/cache";

import {
  taskPriorityToDb,
  validateAssignAction,
  validateUpdateTeamTask,
  type ActionStatus,
} from "@/lib/actions";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

export type TaskMutationResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function revalidateTaskSurfaces() {
  revalidatePath("/admin/actions");
  revalidatePath("/actions");
  revalidatePath("/dashboard");
}

function taskFailure(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case "42501":
      return "Only an administrator can change team tasks.";
    case "40001":
      return "This task changed while you had it open. Refresh it before saving.";
    case "P0002":
      return "That task could not be found. Refresh and try again.";
    case "23503":
      return "Choose an active CAM or administrator for this task.";
    case "23514":
      return "Check the task details and try again.";
    default:
      return "The task could not be saved. Refresh and try again.";
  }
}

async function assigneeIsAvailable(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("id", id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .in("role", ["cam", "admin"])
    .maybeSingle();
  return !error && Boolean(data);
}

export async function createTeamTaskAction(input: {
  organisationId: unknown;
  assigneeUserId: unknown;
  title: unknown;
  description: unknown;
  dueDate: unknown;
  priority: unknown;
}): Promise<TaskMutationResult> {
  const authorization = await getCurrentActor("user:manage", { route: "/admin/actions" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const parsed = validateAssignAction(input);
  if (!parsed.success) return { ok: false, message: parsed.message };
  if (!(await assigneeIsAvailable(parsed.data.assigneeUserId))) {
    return { ok: false, message: "Choose an active CAM or administrator for this task." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("actions").insert({
    organisation_id: parsed.data.organisationId,
    assignee_user_id: parsed.data.assigneeUserId,
    created_by_user_id: authorization.actor.id,
    title: parsed.data.title,
    description: parsed.data.description,
    due_date: parsed.data.dueDate,
    priority: taskPriorityToDb(parsed.data.priority),
  });

  if (error) {
    await reportError(error, {
      operation: "admin.tasks.create",
      actorUserId: authorization.actor.id,
      organisationId: parsed.data.organisationId,
      assigneeUserId: parsed.data.assigneeUserId,
    });
    return { ok: false, message: taskFailure(error) };
  }

  revalidateTaskSurfaces();
  return { ok: true, message: "Task created. It is on their My tasks page now." };
}

export async function updateTeamTaskAction(input: {
  actionId: unknown;
  assigneeUserId: unknown;
  title: unknown;
  description: unknown;
  dueDate: unknown;
  priority: unknown;
  expectedUpdatedAt: unknown;
}): Promise<TaskMutationResult> {
  const authorization = await getCurrentActor("user:manage", { route: "/admin/actions" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const parsed = validateUpdateTeamTask(input);
  if (!parsed.success) return { ok: false, message: parsed.message };
  if (!(await assigneeIsAvailable(parsed.data.assigneeUserId))) {
    return { ok: false, message: "Choose an active CAM or administrator for this task." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_team_task", {
    p_action_id: parsed.data.actionId,
    p_title: parsed.data.title,
    p_description: parsed.data.description,
    p_due_date: parsed.data.dueDate,
    p_priority: taskPriorityToDb(parsed.data.priority),
    p_assignee_user_id: parsed.data.assigneeUserId,
    p_expected_updated_at: parsed.data.expectedUpdatedAt,
  });

  if (error) {
    if (!["42501", "40001", "P0002", "23503", "23514"].includes(error.code ?? "")) {
      await reportError(error, {
        operation: "admin.tasks.update",
        actorUserId: authorization.actor.id,
        actionId: parsed.data.actionId,
      });
    }
    return { ok: false, message: taskFailure(error) };
  }

  revalidateTaskSurfaces();
  return { ok: true, message: "Task updated." };
}

export async function setTeamTaskStatusAction(input: {
  actionId: unknown;
  status: unknown;
  expectedUpdatedAt: unknown;
}): Promise<TaskMutationResult> {
  const authorization = await getCurrentActor("user:manage", { route: "/admin/actions" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  if (!isUuid(input.actionId)) {
    return { ok: false, message: "That task could not be found. Refresh and try again." };
  }
  if (!(["open", "completed", "cancelled"] as const).includes(input.status as ActionStatus)) {
    return { ok: false, message: "Choose Open, Completed or Cancelled." };
  }
  if (typeof input.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(input.expectedUpdatedAt))) {
    return { ok: false, message: "Refresh this task before changing its status." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_team_task_status", {
    p_action_id: input.actionId,
    p_status: input.status as ActionStatus,
    p_expected_updated_at: input.expectedUpdatedAt,
  });

  if (error) {
    if (!["42501", "40001", "P0002"].includes(error.code ?? "")) {
      await reportError(error, {
        operation: "admin.tasks.status",
        actorUserId: authorization.actor.id,
        actionId: input.actionId,
      });
    }
    return { ok: false, message: taskFailure(error) };
  }

  revalidateTaskSurfaces();
  const message =
    input.status === "open"
      ? "Task restored to Open."
      : input.status === "completed"
        ? "Task marked complete. You can restore it from Completed tasks."
        : "Task cancelled. You can restore it from Cancelled tasks.";
  return { ok: true, message };
}
