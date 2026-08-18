import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { nonEmptyTrimmed, safeValidate } from "@/lib/validation";

/**
 * F073 — edit a note the caller wrote (or, for an admin, any note). RLS
 * (`notes_update_own`, 20260804180000_create_org_children.sql) already
 * restricts the underlying write to the note's author or an admin, but the
 * lookup-then-check below runs first so a blocked attempt gets "you can only
 * edit your own notes" rather than a generic failure from an update that
 * silently matched zero rows.
 *
 * No RPC / audit_log write here, same reasoning as the sibling POST route: an
 * edit is not an ownership/status/role/approval change
 * (docs/audit-log-pattern.md §1), and `notes_update_own` already grants this
 * directly to `authenticated`.
 *
 * Preserving old content is explicitly out of scope (F073's own "blocked by"
 * note leaves it open; AC3 — "updates the note in place rather than creating
 * a duplicate" — settles it against keeping one): this overwrites `content`
 * and relies on `updated_at` (set by the existing `notes_set_updated_at`
 * trigger) as the only "this changed" signal, same as F071's `edited` flag.
 */

const MAX_NOTE_LENGTH = 4000;

const bodySchema = z.object({
  content: nonEmptyTrimmed(MAX_NOTE_LENGTH, "Write something before saving."),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId, noteId } = await params;
  if (
    !z.uuid().safeParse(organisationId).success ||
    !z.uuid().safeParse(noteId).success
  ) {
    return NextResponse.json({ error: "That note could not be found." }, { status: 400 });
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
      route: "/api/clients/[id]/notes/[noteId]",
      fieldCount: Object.keys(parsed.fieldErrors).length,
    });
    return NextResponse.json(
      { error: parsed.fieldErrors.content?.[0] ?? "Write something before saving." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data: existing, error: lookupError } = await supabase
    .from("notes")
    .select("id, author_id, content")
    .eq("id", noteId)
    .eq("organisation_id", organisationId)
    .maybeSingle<{ id: string; author_id: string | null; content: string }>();

  if (lookupError) {
    await reportError(lookupError, {
      operation: "clients.notes_edit_lookup",
      organisationId,
      noteId,
    });
    return NextResponse.json(
      { error: "The note could not be saved. Please try again." },
      { status: 500 },
    );
  }

  if (!existing) {
    return NextResponse.json({ error: "That note could not be found." }, { status: 404 });
  }

  // F073 AC1 — checked explicitly rather than left to RLS alone, so a
  // different CAM's attempt gets a message that says why, not a generic one.
  const canEdit =
    authorization.actor.role === "admin" || existing.author_id === authorization.actor.id;
  if (!canEdit) {
    logSecurityEvent("permission.denied", {
      route: "/api/clients/[id]/notes/[noteId]",
      reason: "not_author",
    });
    return NextResponse.json({ error: "You can only edit your own notes." }, { status: 403 });
  }

  // A genuine no-op — the edit didn't actually change anything — skips the
  // write entirely, so "edited" (driven by updated_at) never shows for a note
  // nobody actually changed (F073 AC2).
  if (existing.content.trim() === parsed.data.content.trim()) {
    return NextResponse.json({ note: existing }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("notes")
    .update({ content: parsed.data.content })
    .eq("id", noteId)
    .select("id, content, created_at, updated_at, author_id")
    .single();

  if (error) {
    await reportError(error, { operation: "clients.notes_edit", organisationId, noteId });
    return NextResponse.json(
      { error: "The note could not be saved. Please try again." },
      { status: error.code === "42501" ? 403 : 500 },
    );
  }

  return NextResponse.json({ note: data }, { status: 200 });
}
