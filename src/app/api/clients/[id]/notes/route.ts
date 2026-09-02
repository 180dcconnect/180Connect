import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { isUuid, nonEmptyTrimmed, safeValidate } from "@/lib/validation";
import { buildReplyNoteContent } from "@/lib/reply-note";

/**
 * F072 — add a free-text note to a client, reached from /clients/[id]. No RPC:
 * unlike role/status/ownership changes (docs/audit-log-pattern.md §1 — "changes
 * ownership, status, role, approval state, or similar"), a note is an ordinary
 * author-owned write, and `notes_insert_author`
 * (20260804180000_create_org_children.sql) already grants it directly to
 * `authenticated`, scoped to `author_id = auth.uid()` and `app.can_write()`
 * (admin/CAM, not viewer — same population `client:edit` gates at the app
 * layer). Forcing this through a SECURITY DEFINER RPC instead would contradict
 * that RLS design, not follow it. Editing (F073) and deleting (F074) follow
 * the same reasoning — see the sibling [noteId]/route.ts.
 */

const MAX_NOTE_LENGTH = 4000;

const bodySchema = z.object({
  content: nonEmptyTrimmed(MAX_NOTE_LENGTH, "Write something before saving."),
  replyEventId: z.uuid().optional(),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId } = await params;
  if (!isUuid(organisationId)) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 400 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = safeValidate(bodySchema, input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/clients/[id]/notes",
      fieldCount: Object.keys(parsed.fieldErrors).length,
    });
    return NextResponse.json(
      { error: parsed.fieldErrors.content?.[0] ?? "Write something before saving." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  let content = parsed.data.content;

  if (parsed.data.replyEventId) {
    // F136: the browser identifies the reply but cannot supply its quote or
    // timestamp. Load both under RLS and scope the event to this client before
    // adding durable context to the ordinary F072 note content.
    const { data: reply, error: replyError } = await supabase
      .from("reply_events")
      .select("id, reply_body, received_at")
      .eq("id", parsed.data.replyEventId)
      .eq("organisation_id", organisationId)
      .maybeSingle<{ id: string; reply_body: string; received_at: string }>();
    if (replyError) {
      await reportError(replyError, {
        operation: "clients.notes_add_reply_context",
        organisationId,
        replyEventId: parsed.data.replyEventId,
      });
      return NextResponse.json(
        { error: "The reply context could not be loaded. The note was not saved." },
        { status: 500 },
      );
    }
    if (!reply) {
      return NextResponse.json(
        { error: "That reply is no longer available. The note was not saved." },
        { status: 404 },
      );
    }
    content = buildReplyNoteContent({
      note: parsed.data.content,
      replyId: reply.id,
      replyBody: reply.reply_body,
      receivedAt: reply.received_at,
    });
    if (content.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: "Shorten the note and try again." },
        { status: 400 },
      );
    }
  }

  // author_id is set here rather than trusted from the client — RLS's own
  // with check (author_id = auth.uid()) would refuse a spoofed value anyway,
  // but setting it explicitly is what makes that guarantee visible in this
  // file rather than only in the migration.
  const { data, error } = await supabase
    .from("notes")
    .insert({
      organisation_id: organisationId,
      author_id: authorization.actor.id,
      content,
    })
    .select("id, content, created_at, updated_at, author_id")
    .single();

  if (error) {
    await reportError(error, { operation: "clients.notes_add", organisationId });
    return NextResponse.json(
      { error: "The note could not be saved. Please try again." },
      { status: error.code === "42501" ? 403 : 500 },
    );
  }

  return NextResponse.json({ note: data }, { status: 201 });
}
