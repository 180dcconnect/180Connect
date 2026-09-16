"use server";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { editDiffers, parseBookletEditInput } from "@/lib/booklet/edit-validation.ts";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";
import { z } from "zod";

export type DeleteBookletVersionResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Deletes one saved booklet version — the currently displayed one. The
 * caller promotes the next history entry (or back to the empty state), so
 * this never leaves the card version-less-but-not-empty.
 *
 * Admin-only, matching the schema's `client_booklets_delete_admin` policy (a
 * bad saved booklet is an admin cleanup, not a CAM action). The RLS policy
 * re-enforces it regardless; the explicit gate keeps the denial message
 * human rather than database-shaped.
 *
 * The audit trail is untouched: booklet_generations rows are append-only
 * compliance records of what was generated, and a deletion must never rewrite
 * what happened — only what is still displayed.
 */
export async function deleteBookletVersion(
  input: unknown,
): Promise<DeleteBookletVersionResult> {
  const parsed = safeValidate(
    z.object({ organisationId: z.uuid(), versionId: z.uuid() }),
    input,
  );
  if (!parsed.success) {
    return { ok: false, message: "That booklet version could not be identified." };
  }
  const authorization = await getCurrentActor("client:contact", {
    route: "/clients/[id]",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  if (authorization.actor.role !== "admin") {
    return { ok: false, message: "Only an administrator can delete a saved booklet." };
  }

  const { organisationId, versionId } = parsed.data;
  // Scoped to both ids, never by version id alone — and through the caller's
  // own RLS session, so the admin-only policy applies rather than a bypass.
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_booklets")
    .delete()
    .eq("id", versionId)
    .eq("organisation_id", organisationId);
  if (error) {
    await reportError(error, {
      operation: "clients.delete_booklet_version",
      organisationId,
    });
    return { ok: false, message: "The booklet could not be deleted. Try again." };
  }
  return { ok: true };
}

export type SaveBookletEditResult =
  | { ok: true; version: { id: string; generatedAt: string; editedBy: string | null } }
  | { ok: false; message: string };

type LatestBookletRow = {
  id: string;
  booklet_text: string;
  website_url: string | null;
  website_context_used: boolean;
};

/**
 * Saves a hand correction of the current booklet as a new version.
 *
 * An edit is an INSERT, never an UPDATE — rows are immutable since F086, and a
 * new row keeps the corrected text undoable from History for free. The
 * `booklet_generations` audit log is untouched: it records what Gemini
 * produced, and an edit changes what is displayed, never what was generated.
 *
 * `getCurrentActor`, not `getViewingActor`: the generate route deliberately
 * lets viewers through (a generation is a read-only research asset), but an
 * edit writes the client record — and a write gated any other way is one a
 * viewer can attempt with no explanation. The panel only renders the control
 * for `client:contact` holders; this gate is the refusal for anyone who
 * reaches it anyway.
 *
 * The write goes through the caller's own RLS session (like the delete above,
 * unlike the generate route's service-role save): the INSERT policy's
 * `can_contact_organisation` check is the per-organisation enforcement, and a
 * bypass would let a CAM edit a client they cannot contact.
 */
export async function saveBookletEdit(input: unknown): Promise<SaveBookletEditResult> {
  const parsed = parseBookletEditInput(input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const authorization = await getCurrentActor("client:contact", {
    route: "/clients/[id]",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  const { organisationId, baseVersionId, text } = parsed.data;

  const supabase = await createClient();

  // Latest-only: history is read-only, so an edit must start from what is on
  // screen now. If a regeneration (or another edit) landed first, the base is
  // stale and the CAM re-does the edit against the new text rather than
  // forking two "current" versions. Two edits racing each other both land as
  // versions; the later generated_at reads as current and nothing is lost.
  const { data: latest, error: latestError } = await supabase
    .from("client_booklets")
    .select("id, booklet_text, website_url, website_context_used")
    .eq("organisation_id", organisationId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle<LatestBookletRow>();
  if (latestError) {
    await reportError(latestError, {
      operation: "clients.edit_booklet_version.load_latest",
      organisationId,
    });
    return { ok: false, message: "The booklet could not be loaded. Try again." };
  }
  if (!latest) {
    return { ok: false, message: "There is no saved booklet to edit — generate one first." };
  }
  if (latest.id !== baseVersionId) {
    return {
      ok: false,
      message:
        "This booklet changed while you were editing it. The latest version is on screen now — review it and edit again if you still need to.",
    };
  }
  if (!editDiffers(latest.booklet_text, text)) {
    return { ok: false, message: "No changes to save yet." };
  }

  const generatedAt = new Date().toISOString();
  const { data: saved, error } = await supabase
    .from("client_booklets")
    .insert({
      organisation_id: organisationId,
      booklet_text: text,
      website_url: latest.website_url,
      website_context_used: latest.website_context_used,
      generated_at: generatedAt,
      edited_by_user_id: authorization.actor.id,
      edited_from_version_id: latest.id,
    })
    .select("id")
    .single();
  if (error) {
    await reportError(error, {
      operation: "clients.edit_booklet_version.save",
      organisationId,
    });
    return { ok: false, message: "The edit could not be saved. Try again." };
  }
  return {
    ok: true,
    version: { id: saved.id, generatedAt, editedBy: authorization.actor.fullName },
  };
}
