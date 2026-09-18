"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { attachmentDeleteRpcFailure, attachmentRpcFailure, textExtractionFailureCopy } from "@/lib/attachments";
import { reportError } from "@/lib/error-logging";
import { extractPdfText } from "@/lib/pdf-text-extraction";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nonEmptyTrimmed, safeValidate } from "@/lib/validation";

const ATTACHMENTS_BUCKET = "client-attachments";
const recordSchema = z.object({
  organisationId: z.uuid(),
  filename: nonEmptyTrimmed(255, "A filename is required."),
  storagePath: nonEmptyTrimmed(500, "The upload could not be identified."),
  contentType: z.string().trim().max(255).nullable().optional(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
});
const extractSchema = z.object({ organisationId: z.uuid(), attachmentId: z.uuid() });
const deleteSchema = z.object({ organisationId: z.uuid(), attachmentId: z.uuid() });

export type AttachmentActionResult = {
  ok: boolean;
  message: string;
  attachmentId?: string;
  extractionStatus?: "succeeded" | "failed" | "not_applicable";
};

async function runExtraction(
  organisationId: string,
  attachmentId: string,
): Promise<AttachmentActionResult> {
  const supabase = await createClient();
  const { data: attachment, error: lookupError } = await supabase
    .from("attachments")
    .select("id, storage_path, content_type, filename")
    .eq("id", attachmentId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (lookupError || !attachment) {
    if (lookupError) await reportError(lookupError, { operation: "attachments.extract.lookup", organisationId, attachmentId });
    return { ok: false, message: "That attachment could not be loaded." };
  }

  const isPdf = attachment.content_type === "application/pdf" || attachment.filename.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    const { error } = await supabase.rpc("record_attachment_text_extraction", {
      p_attachment_id: attachmentId, p_status: "not_applicable", p_text: null,
      p_failure_reason: "unsupported_file_type", p_page_count: null, p_truncated: false,
    });
    if (error) {
      await reportError(error, { operation: "attachments.extract.record_not_applicable", organisationId, attachmentId });
      return { ok: false, message: "The attachment was saved, but its extraction state could not be recorded." };
    }
    revalidatePath(`/clients/${organisationId}`);
    return { ok: true, message: "Text extraction is available for PDF files only.", attachmentId, extractionStatus: "not_applicable" };
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .download(attachment.storage_path);
  if (downloadError || !blob) {
    await reportError(downloadError ?? new Error("Storage returned no attachment bytes."), {
      operation: "attachments.extract.read", organisationId, attachmentId,
    });
    const { error: failureStateError } = await supabase.rpc("record_attachment_text_extraction", {
      p_attachment_id: attachmentId, p_status: "failed", p_text: null,
      p_failure_reason: "file_could_not_be_read", p_page_count: null, p_truncated: false,
    });
    if (failureStateError) {
      await reportError(failureStateError, { operation: "attachments.extract.record_read_failure", organisationId, attachmentId });
      return { ok: false, message: "The PDF was saved, but its extraction failure could not be recorded." };
    }
    revalidatePath(`/clients/${organisationId}`);
    return { ok: true, message: "The PDF was saved, but its text could not be extracted.", attachmentId, extractionStatus: "failed" };
  }

  const result = await extractPdfText(new Uint8Array(await blob.arrayBuffer()));
  if (!result.ok) {
    await reportError(new Error(`PDF text extraction failed: ${result.reason}`), {
      operation: "attachments.extract.parse", organisationId, attachmentId, reason: result.reason,
    });
  }
  const status = result.ok ? "succeeded" : "failed";
  const { error: recordError } = await supabase.rpc("record_attachment_text_extraction", {
    p_attachment_id: attachmentId,
    p_status: status,
    p_text: result.ok ? result.text : null,
    p_failure_reason: result.ok ? null : result.reason,
    p_page_count: result.ok ? result.pageCount : null,
    p_truncated: result.ok ? result.truncated : false,
  });
  if (recordError) {
    await reportError(recordError, { operation: "attachments.extract.record", organisationId, attachmentId });
    return { ok: false, message: "The PDF was read, but the extracted text could not be saved." };
  }
  revalidatePath(`/clients/${organisationId}`);
  return {
    ok: true, attachmentId, extractionStatus: status,
    message: result.ok ? "PDF text extracted and ready to use." : textExtractionFailureCopy(result.reason),
  };
}

export async function extractAttachmentText(input: unknown): Promise<AttachmentActionResult> {
  const parsed = safeValidate(extractSchema, input);
  if (!parsed.success) return { ok: false, message: "That attachment could not be identified." };
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) return { ok: false, message: actorFailureMessage(authorization.reason) };
  return runExtraction(parsed.data.organisationId, parsed.data.attachmentId);
}

export async function recordUploadedAttachment(input: unknown): Promise<AttachmentActionResult> {
  const parsed = safeValidate(recordSchema, input);
  if (!parsed.success) {
    return { ok: false, message: Object.values(parsed.fieldErrors).flat().find(Boolean) ?? "That upload could not be recorded." };
  }
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) return { ok: false, message: actorFailureMessage(authorization.reason) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_attachment", {
    p_organisation_id: parsed.data.organisationId,
    p_filename: parsed.data.filename,
    p_storage_path: parsed.data.storagePath,
    p_content_type: parsed.data.contentType ?? null,
    p_size_bytes: parsed.data.sizeBytes ?? null,
  });
  if (error) {
    await reportError(error, { operation: "clients.record_attachment", organisationId: parsed.data.organisationId });
    return { ok: false, message: attachmentRpcFailure(error).error };
  }
  return runExtraction(parsed.data.organisationId, data as string);
}

export async function extractAttachmentTextForm(formData: FormData): Promise<void> {
  await extractAttachmentText({
    organisationId: formData.get("organisationId"),
    attachmentId: formData.get("attachmentId"),
  });
}

export type DeleteAttachmentResult = { ok: boolean; message: string };

/**
 * Deletes one of a client's files: the metadata row through the
 * delete_attachment RPC, then the bytes through the service-role Storage API.
 *
 * The RPC runs first deliberately. It is the authorization boundary
 * (self-checks app.can_write() and the attachment/client pairing), so the
 * Storage removal only ever happens after an authorized row delete — never
 * before. There is intentionally no DELETE policy on the bucket for client
 * roles; the service-role client is the only path that can remove the object.
 *
 * A Storage cleanup failure is logged, never surfaced: the row the CAM sees
 * is already gone, so reporting an error would read as a failure the refresh
 * contradicts. The orphaned object appears in nobody's list — the same
 * accepted trade-off as the discard-draft sweep in outreach-actions.ts.
 */
export async function deleteClientAttachment(input: unknown): Promise<DeleteAttachmentResult> {
  const parsed = safeValidate(deleteSchema, input);
  if (!parsed.success) return { ok: false, message: "That attachment could not be identified." };
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) return { ok: false, message: actorFailureMessage(authorization.reason) };
  const { organisationId, attachmentId } = parsed.data;
  const supabase = await createClient();
  const { data: storagePath, error } = await supabase.rpc("delete_attachment", {
    p_attachment_id: attachmentId,
    p_organisation_id: organisationId,
  });
  if (error) {
    await reportError(error, { operation: "clients.delete_attachment", organisationId, attachmentId });
    return { ok: false, message: attachmentDeleteRpcFailure(error).error };
  }
  const admin = createAdminClient();
  if (!admin) {
    await reportError(new Error("No admin client available for attachment storage cleanup"), {
      operation: "clients.delete_attachment.cleanup_no_admin_client",
      organisationId,
      attachmentId,
    });
  } else if (typeof storagePath === "string" && storagePath) {
    const { error: removeError } = await admin.storage
      .from(ATTACHMENTS_BUCKET)
      .remove([storagePath]);
    if (removeError) {
      await reportError(removeError, {
        operation: "clients.delete_attachment.cleanup_storage",
        organisationId,
        attachmentId,
      });
    }
  }
  revalidatePath(`/clients/${organisationId}`);
  return { ok: true, message: "File deleted." };
}
