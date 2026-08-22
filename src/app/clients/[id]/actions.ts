"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  suggestEditRpcFailure,
  validateSuggestEdit,
  type SuggestEditState,
} from "@/lib/edit-suggestions";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";

/**
 * #79 (F077) — submit a suggested edit for one of a client's six sensitive fields.
 *
 * The action is deliberately thin: permission gate, validation, RPC. Every rule that
 * matters (allowlist, current-value snapshot, supersede-own/block-others) is enforced
 * inside suggest_organisation_edit, because the Server Action is not the only door —
 * the RPC is reachable through PostgREST directly and must hold on its own.
 *
 * No audit_log write here either, matching the RPC (submission is not a decision —
 * see the migration header). Unexpected failures go to ERROR_LOG via reportError.
 */
export async function suggestEditAction(
  _previous: SuggestEditState,
  formData: FormData,
): Promise<SuggestEditState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const parsed = validateSuggestEdit({
    organisationId: formData.get("organisationId"),
    fieldName: formData.get("fieldName"),
    fieldValue: formData.get("fieldValue"),
  });
  if (!parsed.success) {
    return { kind: "error", message: parsed.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("suggest_organisation_edit", {
    p_organisation_id: parsed.data.organisationId,
    p_field_name: parsed.data.fieldName,
    p_new_value: parsed.data.fieldValue,
  });

  if (error) {
    const failure = suggestEditRpcFailure(error);
    // Deliberate refusals (42501/23514/23505/55000/P0002) are user-facing messages,
    // not incidents; anything else is an unexpected failure worth ERROR_LOG.
    if (failure.status === 500) {
      await reportError(error, {
        operation: "clients.suggest_edit",
        actorUserId: authorization.actor.id,
        organisationId: parsed.data.organisationId,
        fieldName: parsed.data.fieldName,
      });
    }
    return { kind: "error", message: failure.error };
  }

  revalidatePath(`/clients/${parsed.data.organisationId}`);

  return {
    kind: "success",
    fieldName: parsed.data.fieldName,
    message: "Suggestion submitted for admin review.",
  };
}
