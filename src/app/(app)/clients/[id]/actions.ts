"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  normaliseFieldValue,
  restrictedFieldLabel,
  suggestEditRpcFailure,
  summariseBatch,
  validateReason,
  validateSuggestEdit,
  type EditBatchState,
  type FieldSubmissionResult,
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
 * The same proposal, for several fields at once, with one note explaining all of
 * them.
 *
 * Corrections do not arrive one field at a time. An address is line 1 plus town
 * plus postcode, and the single-field action made that three trips through a
 * dialog, three pending rows, and three unrelated-looking decisions on the
 * admin's desk. This takes the whole set the CAM edited in one sitting.
 *
 * Still one `edit_suggestions` row per field — the schema is right, an admin
 * must be able to approve the postcode and reject the town — but one action,
 * one note, and one reported outcome.
 *
 * Fields are submitted in sequence rather than in parallel: each call to
 * suggest_organisation_edit supersedes the caller's own pending row for that
 * field, and the RPC's read-then-write is not something to run concurrently
 * against itself.
 */
export async function suggestEditsAction(input: {
  organisationId: string;
  reason: string | null;
  changes: { fieldName: string; value: string }[];
}): Promise<EditBatchState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason), results: [] };
  }

  if (input.changes.length === 0) {
    return { kind: "error", message: "Nothing has been changed yet.", results: [] };
  }

  const reason = validateReason(input.reason);
  if (!reason.ok) {
    return { kind: "error", message: reason.message, results: [] };
  }

  const supabase = await createClient();
  const { data: fieldRows } = await supabase
    .from("restricted_edit_fields")
    .select("field_name")
    .eq("active", true);
  const allowedFields = (fieldRows ?? []).map((row) => row.field_name);

  const results: FieldSubmissionResult[] = [];

  for (const change of input.changes) {
    // Normalised before validation, so the length cap is measured against what
    // will actually be stored and a value that only differs from the current one
    // by a scheme or a stray space is caught here rather than by the RPC.
    const value = normaliseFieldValue(change.fieldName, change.value);
    const parsed = validateSuggestEdit({
      organisationId: input.organisationId,
      fieldName: change.fieldName,
      fieldValue: value,
      allowedFields,
    });
    if (!parsed.success) {
      results.push({ fieldName: change.fieldName, ok: false, message: parsed.message });
      continue;
    }

    const { error } = await supabase.rpc("suggest_organisation_edit", {
      p_organisation_id: parsed.data.organisationId,
      p_field_name: parsed.data.fieldName,
      p_new_value: parsed.data.fieldValue,
      p_reason: reason.value,
    });

    if (error) {
      const failure = suggestEditRpcFailure(error);
      if (failure.status === 500) {
        await reportError(error, {
          operation: "clients.suggest_edits",
          actorUserId: authorization.actor.id,
          organisationId: input.organisationId,
          fieldName: parsed.data.fieldName,
        });
      }
      results.push({ fieldName: parsed.data.fieldName, ok: false, message: failure.error });
      continue;
    }

    results.push({
      fieldName: parsed.data.fieldName,
      ok: true,
      message: `${restrictedFieldLabel(parsed.data.fieldName)} sent for review.`,
    });
  }

  if (results.some((result) => result.ok)) {
    revalidatePath(`/clients/${input.organisationId}`, "layout");
  }

  return summariseBatch(results, "proposed");
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
