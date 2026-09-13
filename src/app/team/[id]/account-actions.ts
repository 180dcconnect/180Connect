"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  accountChangeFailureMessage,
  reactivateFailureMessage,
} from "@/lib/auth/account-changes";
import { canChangeAccess } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";

/**
 * Suspend, reactivate and delete — the account controls on a member's profile.
 *
 * Server Actions colocated with the page that renders the controls, per the repo's
 * mutation convention. Each is a thin wrapper: the RPC is the whole change (revoking
 * sessions, handing work on and the audit rows all happen in its transaction), and
 * its HINT is translated by account-changes.ts, the one place hints are read.
 */

export type AccountActionResult =
  | { ok: true; mode?: "deleted" | "redacted"; clientsMoved: number }
  | { ok: false; error: string };

const handover = {
  reassignTo: z.uuid().optional(),
  releaseClients: z.boolean().optional(),
};

/** A reason is optional here; the database requires one only when work moves. */
const suspendSchema = z.object({
  userId: z.uuid(),
  reason: z.string().trim().max(500).optional(),
  ...handover,
});

/** Irreversible, so a reason is always required. */
const deleteSchema = z.object({
  userId: z.uuid(),
  reason: z.string().trim().min(1, "Give a reason for deleting this team member.").max(500),
  ...handover,
});

const reactivateSchema = z.object({ userId: z.uuid() });

function paths(userId: string) {
  revalidatePath(`/team/${userId}`);
  revalidatePath("/admin/users");
}

export async function suspendTeamMember(input: unknown): Promise<AccountActionResult> {
  const authorization = await getCurrentActor("user:manage", { route: "/team/[id]" });
  if (!authorization.ok) return { ok: false, error: actorFailureMessage(authorization.reason) };

  const parsed = safeValidate(suspendSchema, input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", { route: "/team/[id]", action: "suspend" });
    return { ok: false, error: "Choose a valid suspension." };
  }

  const access = canChangeAccess(authorization.actor.id, parsed.data.userId);
  if (!access.ok) return { ok: false, error: access.message };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("suspend_user", {
    p_user_id: parsed.data.userId,
    p_reason: parsed.data.reason || null,
    p_reassign_to: parsed.data.reassignTo ?? null,
    p_release_clients: parsed.data.releaseClients ?? false,
  });

  if (error) {
    await reportError(error, { operation: "team.suspend_user", targetUserId: parsed.data.userId });
    return { ok: false, error: accountChangeFailureMessage("suspend", error.hint) };
  }

  paths(parsed.data.userId);
  return {
    ok: true,
    clientsMoved: (data as { clients_moved?: number } | null)?.clients_moved ?? 0,
  };
}

export async function reactivateTeamMember(input: unknown): Promise<AccountActionResult> {
  const authorization = await getCurrentActor("user:manage", { route: "/team/[id]" });
  if (!authorization.ok) return { ok: false, error: actorFailureMessage(authorization.reason) };

  const parsed = safeValidate(reactivateSchema, input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", { route: "/team/[id]", action: "reactivate" });
    return { ok: false, error: "This team member could not be identified." };
  }

  const access = canChangeAccess(authorization.actor.id, parsed.data.userId);
  if (!access.ok) return { ok: false, error: access.message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_active", {
    p_user_id: parsed.data.userId,
    p_is_active: true,
  });

  if (error) {
    await reportError(error, { operation: "team.reactivate_user", targetUserId: parsed.data.userId });
    return { ok: false, error: reactivateFailureMessage(error.hint) };
  }

  paths(parsed.data.userId);
  return { ok: true, clientsMoved: 0 };
}

export async function deleteTeamMember(input: unknown): Promise<AccountActionResult> {
  const authorization = await getCurrentActor("user:manage", { route: "/team/[id]" });
  if (!authorization.ok) return { ok: false, error: actorFailureMessage(authorization.reason) };

  const parsed = safeValidate(deleteSchema, input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", { route: "/team/[id]", action: "delete" });
    return {
      ok: false,
      error: parsed.fieldErrors.reason?.[0] ?? "Choose a valid deletion.",
    };
  }

  if (!canChangeAccess(authorization.actor.id, parsed.data.userId).ok) {
    return { ok: false, error: accountChangeFailureMessage("delete", "self_access_change") };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_user", {
    p_user_id: parsed.data.userId,
    p_reason: parsed.data.reason,
    p_reassign_to: parsed.data.reassignTo ?? null,
    p_release_clients: parsed.data.releaseClients ?? false,
  });

  if (error) {
    // owns_active_clients is the reassignment gate doing its job, not a failure.
    if (error.hint !== "owns_active_clients") {
      await reportError(error, { operation: "team.delete_user", targetUserId: parsed.data.userId });
    }
    return { ok: false, error: accountChangeFailureMessage("delete", error.hint) };
  }

  const outcome = data as { mode?: "deleted" | "redacted"; clients_moved?: number } | null;
  paths(parsed.data.userId);
  return { ok: true, mode: outcome?.mode ?? "deleted", clientsMoved: outcome?.clients_moved ?? 0 };
}
