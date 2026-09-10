"use server";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
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
