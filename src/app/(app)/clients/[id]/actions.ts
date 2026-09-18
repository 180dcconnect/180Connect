"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { fetchPaged } from "@/lib/supabase/fetch-paged";
import { getActiveScoutConfig } from "@/lib/scoring/configured-weights";
import {
  describeInsufficientData,
  findSimilarClients,
  MAX_SIMILAR_MATCHES,
  SIMILAR_PREVIEW_COUNT,
} from "@/lib/similar-clients";
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
import {
  grantCountOf,
  LIST_COLUMNS,
  visibleClients,
  type ClientListRow,
  type OpenSuppression,
  type VisibleClient,
} from "../visible-clients.ts";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { safeValidate, uuidField } from "@/lib/validation";
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

/**
 * A CAM's "there is nothing to put here": the proposal that a client has no
 * website at all.
 *
 * Not an edit. Nothing is written to organisations.website — a CAM could not
 * write that column anyway (restricted) — and the row lands in the same approvals
 * queue as a correction, where an admin either records the mark they can also set
 * from the incomplete-records screen, or rejects it.
 *
 * Its own action rather than another entry in suggestEditsAction: that one
 * carries a value per field, and this proposal's whole content is that there is
 * no value to carry.
 */
export async function suggestWebsiteAbsentAction(input: {
  organisationId: string;
  reason: string | null;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { ok: false, error: actorFailureMessage(authorization.reason) };
  }

  const parsed = safeValidate(
    z.object({
      organisationId: uuidField(
        "That client could not be identified. Refresh the page and try again.",
      ),
      reason: z
        .string()
        .trim()
        .max(280, "Keep the note to 280 characters or fewer.")
        .nullable(),
    }),
    input,
  );
  if (!parsed.success) {
    return {
      ok: false,
      error:
        Object.values(parsed.fieldErrors).flat()[0] ??
        "That could not be sent for review. Refresh the page and try again.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("suggest_website_absent", {
    p_organisation_id: parsed.data.organisationId,
    p_reason: parsed.data.reason?.trim() || null,
  });

  if (error) {
    const failure = suggestEditRpcFailure(error);
    if (failure.status === 500) {
      await reportError(error, {
        operation: "clients.suggest_website_absent",
        actorUserId: authorization.actor.id,
        organisationId: parsed.data.organisationId,
      });
    }
    return { ok: false, error: failure.error };
  }

  revalidatePath(`/clients/${parsed.data.organisationId}`, "layout");
  revalidatePath("/admin/approvals");
  return {
    ok: true,
    message: "Sent to an admin to confirm this client has no website.",
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

const similarPreviewSchema = z.object({ organisationId: uuidField() });

export type SimilarPreviewMatch = {
  id: string;
  name: string;
  /** Agreement on the reference's known dimensions, 0-100. */
  percent: number;
  /** One plain-English reason per shared dimension, in display order. */
  reasons: string[];
};

export type SimilarPreviewResult =
  | {
      status: "ok";
      /** Matches, up to the list page's own cap. */
      total: number;
      /** True when more matches exist than the list page shows. */
      capped: boolean;
      /** The reference's known dimensions, in words ("sector, location and size"). */
      basis: string[];
      matches: SimilarPreviewMatch[];
    }
  | { status: "insufficient"; message: string }
  | { status: "error"; message: string };

/**
 * The record card's similar-clients preview. Runs the same data-rules
 * comparison (`findSimilarClients`) over the same visible rows the client
 * list reads — LIST_COLUMNS in ../visible-clients.ts, so the two can never
 * disagree — and returns only the top few plus the total for the "view all"
 * link. No AI, no extra columns, no writes: read-only under `client:view`,
 * so viewers get the same shortlist as everyone else.
 *
 * Loaded on expand rather than with the page, so a record view pays for the
 * full-list read only when its reader actually asks who looks similar.
 */
export async function getSimilarClientsPreviewAction(input: {
  organisationId: string;
}): Promise<SimilarPreviewResult> {
  const authorization = await getCurrentActor("client:view", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const parsed = safeValidate(similarPreviewSchema, input);
  if (!parsed.success) {
    return { status: "error", message: "That client could not be read." };
  }
  const organisationId = parsed.data.organisationId;

  const supabase = await createClient();
  try {
    const [organisations, openSuppressions, scoutConfig] = await Promise.all([
      fetchPaged<ClientListRow>(
        (from, to) =>
          supabase
            .from("organisations")
            .select(LIST_COLUMNS)
            .order("period_end", {
              foreignTable: "financial_periods",
              ascending: false,
              nullsFirst: false,
            })
            .limit(3, { foreignTable: "financial_periods" })
            .order("legal_name", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to)
            .overrideTypes<ClientListRow[], { merge: false }>(),
        { pagesPerRound: 3 },
      ),
      fetchPaged<OpenSuppression>((from, to) =>
        supabase
          .from("suppressions")
          .select("organisation_id, status")
          .in("status", ["pending", "active"])
          .order("organisation_id", { ascending: true })
          .range(from, to)
          .overrideTypes<OpenSuppression[], { merge: false }>(),
      ),
      getActiveScoutConfig(),
    ]);
    if (organisations.error) throw organisations.error;
    if (openSuppressions.error) throw openSuppressions.error;

    const allVisible = visibleClients(organisations.data ?? [], openSuppressions.data ?? []);
    const reference = allVisible.find((client) => client.id === organisationId) ?? null;
    if (!reference) {
      return { status: "error", message: "This client could not be read." };
    }

    const withGrantCounts = (client: VisibleClient) => ({
      ...client,
      matched_grant_count: grantCountOf(client),
    });
    const result = findSimilarClients(
      withGrantCounts(reference),
      allVisible.map(withGrantCounts),
      {
        priorityRegions: scoutConfig.rules?.geography.priorityTowns,
        limit: MAX_SIMILAR_MATCHES,
      },
    );

    if (result.status === "insufficient_data") {
      return {
        status: "insufficient",
        message: describeInsufficientData({
          status: "insufficient_data",
          reason: result.reason ?? "too_few_matches",
          reference: result.reference,
          matches: result.matches,
        }),
      };
    }

    return {
      status: "ok",
      total: result.matches.length,
      capped: result.matches.length >= MAX_SIMILAR_MATCHES,
      basis: result.reference.knownDimensions.map((d) => d.label.toLowerCase()),
      matches: result.matches.slice(0, SIMILAR_PREVIEW_COUNT).map((match) => ({
        id: match.client.id,
        name: match.client.legal_name,
        percent: Math.round(match.similarity * 100),
        reasons: match.sharedDimensions.map((d) => d.description),
      })),
    };
  } catch (thrown) {
    await reportError(thrown, {
      operation: "clients.similar_preview",
      actorUserId: authorization.actor.id,
      organisationId,
    });
    return { status: "error", message: "Similar clients could not be loaded. Try again." };
  }
}
