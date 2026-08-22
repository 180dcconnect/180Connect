import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { nonEmptyTrimmed, safeValidate } from "@/lib/validation";

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
  if (!z.uuid().safeParse(organisationId).success) {
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

  // author_id is set here rather than trusted from the client — RLS's own
  // with check (author_id = auth.uid()) would refuse a spoofed value anyway,
  // but setting it explicitly is what makes that guarantee visible in this
  // file rather than only in the migration.
  const { data, error } = await supabase
    .from("notes")
    .insert({
      organisation_id: organisationId,
      author_id: authorization.actor.id,
      content: parsed.data.content,
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
