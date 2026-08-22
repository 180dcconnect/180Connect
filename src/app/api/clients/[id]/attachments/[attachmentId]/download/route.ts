import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";

/**
 * F080 AC2 — "opened or downloaded from the list". The attachments bucket is
 * private (20260823090000_create_attachments.sql), so the list itself can't
 * link straight to Storage; this route looks the row up under the caller's own
 * RLS-scoped session, then exchanges it for a short-lived signed URL and
 * redirects. No file bytes pass through this server — Storage streams them
 * straight to the browser from the signed URL.
 */

const ATTACHMENTS_BUCKET = "client-attachments";
const SIGNED_URL_TTL_SECONDS = 60;

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const authorization = await getCurrentActor("client:view", {
    route: "/api/clients/[id]/attachments/[attachmentId]/download",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId, attachmentId } = await params;
  if (
    !z.uuid().safeParse(organisationId).success ||
    !z.uuid().safeParse(attachmentId).success
  ) {
    return NextResponse.json({ error: "That attachment could not be found." }, { status: 400 });
  }

  const supabase = await createClient();

  // RLS (attachments_select_active) already scopes what this caller may read;
  // matching organisation_id here is a correctness check — the id in the URL is
  // the client it claims to be attached to — not a second authorization gate.
  const { data: attachment, error: attachmentError } = await supabase
    .from("attachments")
    .select("id, filename, storage_path")
    .eq("id", attachmentId)
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (attachmentError) {
    await reportError(attachmentError, {
      operation: "clients.attachment_download_lookup",
      organisationId,
    });
    return NextResponse.json(
      { error: "That attachment could not be loaded. Refresh and try again." },
      { status: 500 },
    );
  }
  if (!attachment) {
    return NextResponse.json({ error: "That attachment could not be found." }, { status: 404 });
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(attachment.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: attachment.filename,
    });

  if (signError || !signed?.signedUrl) {
    await reportError(signError ?? new Error("createSignedUrl returned no URL"), {
      operation: "clients.attachment_download_sign",
      organisationId,
    });
    return NextResponse.json(
      { error: "This file could not be opened right now. Refresh and try again." },
      { status: 502 },
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}
