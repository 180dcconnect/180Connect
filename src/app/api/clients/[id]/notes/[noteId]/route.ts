import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { isUuid, nonEmptyTrimmed, safeValidate } from "@/lib/validation";

/**
 * F073 (edit) / F074 (delete) — act on a note the caller wrote (or, for an
 * admin, any note). RLS (`notes_update_own` / `notes_delete_own`, both in
 * 20260804180000_create_org_children.sql, sharing the identical author-or-
 * admin predicate) already restricts the underlying write, but the
 * lookup-then-check below runs first so a blocked attempt gets "you can only
 * [edit/delete] your own notes" rather than a generic failure from a write
 * that silently matched zero rows.
 *
 * No RPC / audit_log write for either verb, same reasoning as the sibling
 * POST route: neither is an ownership/status/role/approval change
 * (docs/audit-log-pattern.md §1), and the RLS policies already grant both
 * directly to `authenticated`.
 *
 * F074's own "blocked by" question (soft-delete vs hard-delete) is resolved:
 * **hard delete, no retention** — confirmed 19 Aug 2026. `notes_delete_own`
 * is already a genuine `DELETE` policy and no soft-delete column exists
 * anywhere in this schema to follow as precedent; adding one here would be
 * new schema work solely for this ticket, not something the existing design
 * already leans toward. A deleted note leaves no record anywhere, including
 * to an admin — that is the deliberate trade-off of this choice, not an
 * oversight.
 */

const MAX_NOTE_LENGTH = 4000;

const bodySchema = z.object({
  content: nonEmptyTrimmed(MAX_NOTE_LENGTH, "Write something before saving."),
});

type ExistingNote = { id: string; author_id: string | null; content: string };

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

/**
 * Shared by PATCH and DELETE: finds the note (scoped to this organisation, so
 * a mismatched URL can't act on a note from a different client) and reports
 * whether it exists and whether the caller may act on it.
 */
async function findManageableNote(
  supabase: SupabaseClient,
  organisationId: string,
  noteId: string,
  actor: { id: string; role: string },
): Promise<
  | { ok: true; note: ExistingNote }
  | { ok: false; status: 404 | 500; error: string }
  | { ok: false; status: 403; error: string; reason: "not_author" }
> {
  const { data: existing, error: lookupError } = await supabase
    .from("notes")
    .select("id, author_id, content")
    .eq("id", noteId)
    .eq("organisation_id", organisationId)
    .maybeSingle<ExistingNote>();

  if (lookupError) {
    await reportError(lookupError, {
      operation: "clients.notes_lookup",
      organisationId,
      noteId,
    });
    return { ok: false, status: 500, error: "The note could not be found. Please try again." };
  }

  if (!existing) {
    return { ok: false, status: 404, error: "That note could not be found." };
  }

  const canManage = actor.role === "admin" || existing.author_id === actor.id;
  if (!canManage) {
    return {
      ok: false,
      status: 403,
      error: "You can only manage your own notes.",
      reason: "not_author",
    };
  }

  return { ok: true, note: existing };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId, noteId } = await params;
  if (
    !isUuid(organisationId) ||
    !isUuid(noteId)
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
  const found = await findManageableNote(supabase, organisationId, noteId, authorization.actor);

  if (!found.ok) {
    if (found.status === 403) {
      logSecurityEvent("permission.denied", {
        route: "/api/clients/[id]/notes/[noteId]",
        method: "PATCH",
        reason: found.reason,
      });
      return NextResponse.json(
        { error: "You can only edit your own notes." },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: found.error }, { status: found.status });
  }

  // A genuine no-op — the edit didn't actually change anything — skips the
  // write entirely, so "edited" (driven by updated_at) never shows for a note
  // nobody actually changed (F073 AC2).
  if (found.note.content.trim() === parsed.data.content.trim()) {
    return NextResponse.json({ note: found.note }, { status: 200 });
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId, noteId } = await params;
  if (
    !isUuid(organisationId) ||
    !isUuid(noteId)
  ) {
    return NextResponse.json({ error: "That note could not be found." }, { status: 400 });
  }

  const supabase = await createClient();
  const found = await findManageableNote(supabase, organisationId, noteId, authorization.actor);

  if (!found.ok) {
    if (found.status === 403) {
      // F074 AC1 — checked explicitly rather than left to RLS alone, so a
      // different CAM's attempt gets a message that says why.
      logSecurityEvent("permission.denied", {
        route: "/api/clients/[id]/notes/[noteId]",
        method: "DELETE",
        reason: found.reason,
      });
      return NextResponse.json(
        { error: "You can only delete your own notes." },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: found.error }, { status: found.status });
  }

  const { error } = await supabase.from("notes").delete().eq("id", noteId);

  if (error) {
    await reportError(error, { operation: "clients.notes_delete", organisationId, noteId });
    return NextResponse.json(
      { error: "The note could not be deleted. Please try again." },
      { status: error.code === "42501" ? 403 : 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
