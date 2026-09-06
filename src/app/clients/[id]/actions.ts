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
import { z } from "zod";
import { safeValidate } from "@/lib/validation";
import {
  TIMELINE_CONTEXT_TYPES,
  attachmentTimelineRpcFailure,
  type TimelineContextType,
} from "@/lib/attachments";

/**
 * #79 + #23 (F077/F020) — submit a suggested edit for one of a client's restricted
 * fields.
 *
 * The action is deliberately thin: permission gate, validation, RPC. Every rule that
 * matters (allowlist, current-value snapshot, supersede-own/block-others) is enforced
 * inside suggest_organisation_edit, because the Server Action is not the only door —
 * the RPC is reachable through PostgREST directly and must hold on its own. The one
 * thing the action adds is the live allowlist: since F020 the restricted set is data,
 * so validation runs against what RESTRICTED_EDIT_FIELDS says right now rather than a
 * compile-time constant.
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

  const supabase = await createClient();
  const { data: fieldRows } = await supabase
    .from("restricted_edit_fields")
    .select("field_name")
    .eq("active", true);
  const allowedFields = (fieldRows ?? []).map((row) => row.field_name);

  const parsed = validateSuggestEdit({
    organisationId: formData.get("organisationId"),
    fieldName: formData.get("fieldName"),
    fieldValue: formData.get("fieldValue"),
    allowedFields,
  });
  if (!parsed.success) {
    return { kind: "error", message: parsed.message };
  }

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

export type LinkAttachmentState =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const linkAttachmentSchema = z.object({
  organisationId: z.uuid(),
  attachmentId: z.uuid(),
  contextKey: z.string().trim().min(1).max(100),
});

/** F219 — persist a file's link to a verified event on this client's timeline. */
export async function linkAttachmentToTimelineAction(
  _previous: LinkAttachmentState,
  formData: FormData,
): Promise<LinkAttachmentState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const parsed = safeValidate(linkAttachmentSchema, {
    organisationId: formData.get("organisationId"),
    attachmentId: formData.get("attachmentId"),
    contextKey: formData.get("contextKey"),
  });
  if (!parsed.success) {
    return { kind: "error", message: "Choose a valid timeline event." };
  }

  const [rawType, rawId] = parsed.data.contextKey.split(":", 2);
  if (!TIMELINE_CONTEXT_TYPES.includes(rawType as TimelineContextType)) {
    return { kind: "error", message: "Choose a valid timeline event." };
  }
  const contextType = rawType as TimelineContextType;
  const contextId = contextType === "client" ? null : rawId;
  const context = safeValidate(
    z.object({
      contextId: contextType === "client" ? z.null() : z.uuid(),
    }),
    { contextId },
  );
  if (!context.success) {
    return { kind: "error", message: "Choose a valid timeline event." };
  }

  const supabase = await createClient();
  let error: { code?: string; message: string } | null;
  try {
    ({ error } = await supabase.rpc("link_attachment_to_timeline", {
      p_attachment_id: parsed.data.attachmentId,
      p_organisation_id: parsed.data.organisationId,
      p_context_type: contextType,
      p_context_id: context.data.contextId,
    }));
  } catch (thrown) {
    await reportError(thrown, {
      operation: "clients.link_attachment_to_timeline",
      actorUserId: authorization.actor.id,
      organisationId: parsed.data.organisationId,
      attachmentId: parsed.data.attachmentId,
    });
    return {
      kind: "error",
      message: "The timeline link could not be saved. Refresh and try again.",
    };
  }

  if (error) {
    const failure = attachmentTimelineRpcFailure(error);
    if (failure.status === 500) {
      await reportError(error, {
        operation: "clients.link_attachment_to_timeline",
        actorUserId: authorization.actor.id,
        organisationId: parsed.data.organisationId,
        attachmentId: parsed.data.attachmentId,
      });
    }
    return { kind: "error", message: failure.error };
  }

  revalidatePath(`/clients/${parsed.data.organisationId}`);
  return { kind: "success", message: "Timeline link saved." };
}
