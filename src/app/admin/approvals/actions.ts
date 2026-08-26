"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import {
  decideEditRpcFailure,
  validateDecideEditInput,
} from "@/lib/edit-suggestions";

export type DecideEditActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Server Action for F181 (Approval Tab).
 *
 * Enforces `approval:manage` permission, safely validates input, calls the
 * audited `decide_edit_suggestion` RPC, logs any error, and revalidates the
 * approvals route.
 */
export async function decideEditSuggestionAction(
  input: unknown,
): Promise<DecideEditActionResult> {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/approvals",
  });
  if (!authorization.ok) {
    return { ok: false, error: actorFailureMessage(authorization.reason) };
  }

  const validation = validateDecideEditInput(input);
  if (!validation.success) {
    const firstError =
      Object.values(validation.fieldErrors).flat()[0] ?? "Invalid decision input.";
    return { ok: false, error: firstError };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_edit_suggestion", {
    p_suggestion_id: validation.data.suggestionId,
    p_approve: validation.data.approve,
    p_reason: validation.data.reason || null,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.approvals.decide_edit_suggestion",
      actorUserId: authorization.actor.id,
      suggestionId: validation.data.suggestionId,
    });
    const { error: message } = decideEditRpcFailure(error);
    return { ok: false, error: message };
  }

  revalidatePath("/admin/approvals");
  return { ok: true };
}
