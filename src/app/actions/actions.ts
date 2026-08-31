"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { completeActionFailure } from "@/lib/actions";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";

export type CompleteActionResult = { ok: true } | { ok: false; message: string };

/**
 * F171 — marks one of the caller's own open actions complete (AC1).
 *
 * Deliberately thin: permission gate, then complete_action, which is where
 * every rule that actually matters lives (assignee-or-admin check, open-only,
 * audit_log write in the same transaction — see
 * 20260913090000_create_complete_action_rpc.sql). The RPC is reachable
 * through PostgREST directly and must hold on its own; this action is not
 * the enforcement point, only the thin server-side entry from the UI.
 */
export async function completeActionAction(actionId: string): Promise<CompleteActionResult> {
  const authorization = await getCurrentActor("client:view", { route: "/actions" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_action", { p_action_id: actionId });

  if (error) {
    const failure = completeActionFailure(error);
    // Deliberate refusals (42501/55000/P0002) are user-facing messages, not
    // incidents; anything else is an unexpected failure worth ERROR_LOG.
    if (failure.status === 500) {
      await reportError(error, {
        operation: "actions.complete",
        actorUserId: authorization.actor.id,
        actionId,
      });
    }
    return { ok: false, message: failure.error };
  }

  // AC2: the next render of /actions no longer shows this row (formatMyActions
  // filters to status='open'), and Next's own cache would otherwise keep
  // serving the pre-completion list on a fast client-side navigation back here.
  revalidatePath("/actions");

  return { ok: true };
}
