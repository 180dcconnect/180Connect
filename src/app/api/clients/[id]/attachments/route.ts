import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { attachmentRpcFailure } from "@/lib/attachments";

/**
 * F081 — the second half of the two-step upload (see
 * 20260823090000_create_attachments.sql's header for the full shape). The
 * browser has already put the file into the client-attachments bucket
 * directly — this route only asks record_attachment to turn that into a row
 * the profile's attachment list (F080) can read. It never receives or
 * forwards file bytes itself.
 *
 * `client:edit` is the gate, same permission the profile's other write
 * actions use. The RPC re-checks `app.can_write()` itself.
 */

const Body = z.object({
  filename: z.string().trim().min(1, "A filename is required."),
  storagePath: z.string().trim().min(1, "The upload could not be identified."),
  contentType: z.string().trim().max(255).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("client:edit", {
    route: "/api/clients/[id]/attachments",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId } = await params;
  if (!z.uuid().safeParse(organisationId).success) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 400 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/clients/[id]/attachments",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That upload could not be recorded." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("record_attachment", {
    p_organisation_id: organisationId,
    p_filename: parsed.data.filename,
    p_storage_path: parsed.data.storagePath,
    p_content_type: parsed.data.contentType ?? null,
    p_size_bytes: parsed.data.sizeBytes ?? null,
  });

  if (error) {
    await reportError(error, { operation: "clients.record_attachment", organisationId });
    const { status, error: message } = attachmentRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ id: data as string }, { status: 201 });
}
