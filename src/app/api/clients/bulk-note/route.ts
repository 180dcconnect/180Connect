import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { safeValidate } from "@/lib/validation";
import {
  MAX_BULK_NOTE_CLIENTS,
  MAX_NOTE_LENGTH,
  bulkNoteInsertFailure,
  bulkNoteSummary,
  commentProblemMessage,
  prepareComment,
} from "@/lib/bulk-note";

/**
 * F065 (#67) — add one comment to every selected client, reached from the bulk bar
 * on /clients.
 *
 * AC2 is the shape of the write: "a separate note entry per client, attributed to
 * the CAM and timestamped, not one shared object linked to many clients". So this
 * builds N rows and inserts them in one statement. One statement is one
 * transaction, which gives the same all-or-nothing guarantee F064's RPC gives —
 * either every selected client gets its comment or none does, and there is no
 * half-commented list for the CAM to reconcile by hand.
 *
 * Unlike /api/clients/bulk-status there is no RPC behind this and no `service`
 * client: the insert runs as the signed-in user, so `notes_insert_author` is what
 * actually authorises it. `client:edit` here is the outer gate that keeps a viewer
 * from reaching a route it would only be refused by RLS anyway — see
 * @/lib/bulk-note for why introducing a SECURITY DEFINER function to duplicate
 * that policy would be a downgrade rather than an improvement.
 */

const bodySchema = z.object({
  ids: z
    .array(z.uuid())
    // Bounds are the app's own (@/lib/bulk-note explains why they cannot be the
    // database's here). Rejecting at parse time keeps an absurd payload from being
    // expanded into row objects and shipped to Postgres at all.
    .min(1)
    .max(MAX_BULK_NOTE_CLIENTS),
  // Length is checked again by prepareComment after trimming; this bound only
  // stops an unbounded string being parsed. Both have to be here: this one is
  // about the payload, that one is about what gets stored.
  comment: z.string().max(MAX_NOTE_LENGTH * 2),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(request: Request) {
  const authorization = await getCurrentActor("client:edit", { route: "/clients" });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  // F222: validation goes through the shared wrapper so error shape stays
  // consistent with the rest of the app's routes and actions (same as
  // /api/clients/bulk-tags).
  const parsed = safeValidate(bodySchema, input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/clients/bulk-note",
      fieldCount: Object.keys(parsed.fieldErrors).length,
    });
    return NextResponse.json(
      { error: `Select between 1 and ${MAX_BULK_NOTE_CLIENTS} clients and write a comment.` },
      { status: 400 },
    );
  }

  const prepared = prepareComment(parsed.data.comment);
  if (!prepared.ok) {
    return NextResponse.json({ error: commentProblemMessage(prepared.problem) }, { status: 400 });
  }

  // Duplicates in the selection would become duplicate notes on one client — the
  // same comment twice, indistinguishable in the timeline. The UI cannot produce
  // them (the selection is a Set) but the route is a public surface, and deduping
  // also keeps `requested` equal to the number of clients the CAM is told about.
  const ids = [...new Set(parsed.data.ids)];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .insert(
      ids.map((organisationId) => ({
        organisation_id: organisationId,
        // Set here rather than left to a default: `notes_insert_author` requires
        // author_id = auth.uid(), so this is both AC2's attribution and the value
        // the policy checks. created_at is the column default (AC2's timestamp).
        author_id: authorization.actor.id,
        content: prepared.content,
      })),
    )
    .select("id");

  if (error) {
    await reportError(error, {
      operation: "clients.bulk_note",
      // The count, not the ids, and never the comment text: an error log is not
      // the place for a copy of what a CAM wrote about a charity.
      selectedCount: ids.length,
    });
    const { status, error: message } = bulkNoteInsertFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  const created = data?.length ?? 0;
  const result = { requested: ids.length, created };
  return NextResponse.json({ ...result, message: bulkNoteSummary(result) }, { status: 200 });
}
