import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { optionalMentionedUsers, safeValidate } from "@/lib/validation";
import {
  MAX_BULK_NOTE_CLIENTS,
  MAX_NOTE_LENGTH,
  bulkNoteInsertFailure,
  bulkNoteSummary,
  commentProblemMessage,
  prepareComment,
} from "@/lib/bulk-note";
import {
  MAX_MENTIONS_PER_NOTE,
  NOTE_ADDED_NOTIFICATION_TYPE,
  NOTE_MENTIONED_NOTIFICATION_TYPE,
  buildBulkMentionTitle,
  buildBulkOwnerGroupTitle,
  buildMentionNoteTitle,
  buildOwnerNoteTitle,
  bulkNotificationLinkPath,
  groupBulkClientsByOwner,
  limitMentionIdsByOccurrences,
  noteNotificationLinkPath,
  sanitizeMentionedUsers,
  summariseNoteContent,
  type MentionedUserInput,
} from "@/lib/note-mentions";

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
  // F485: the composer's @mention choices as id+name pairs (see the
  // single-note route for why pairs, not bare ids). Shared primitive with
  // that route (validation.ts); the server binds each pair to an actual
  // `@Name` occurrence below, so request-provided pairs alone notify nobody.
  mentionedUsers: optionalMentionedUsers(MAX_MENTIONS_PER_NOTE),
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
    // organisation_id rides along so the single-client-per-owner notification
    // below can point at the exact note row it is about.
    .select("id, organisation_id");

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

  // F485 — best-effort fan-out after the batch commits. A notification
  // failure must never fail the comments that caused it: the batch is saved
  // above, and everything below only reports.
  await notifyBulkNoteRecipients({
    organisationIds: ids,
    noteRows: (data ?? []) as { id: string; organisation_id: string }[],
    content: prepared.content,
    authorId: authorization.actor.id,
    authorName: authorization.actor.fullName?.trim() || "A team member",
    mentionedUsers: parsed.data.mentionedUsers ?? [],
  });

  return NextResponse.json({ ...result, message: bulkNoteSummary(result) }, { status: 200 });
}

/**
 * F485 producer for a bulk comment. One notification per distinct owner
 * (grouped — per-client rows would flood the bell for one click), plus one
 * per mentioned user. Never throws: every failure is reported (ERROR_LOG
 * via `reportError`) and swallowed, so the saved comments always survive.
 *
 * Same permission posture as the single-note producer: organisations are
 * shared-read across all active roles, so "could already read that client"
 * reduces to `is_active` — enforced by verifying mentioned ids against
 * active users here *and* by `create_notification` itself.
 */
async function notifyBulkNoteRecipients(args: {
  organisationIds: string[];
  noteRows: { id: string; organisation_id: string }[];
  content: string;
  authorId: string;
  authorName: string;
  mentionedUsers: MentionedUserInput[];
}): Promise<void> {
  try {
    const supabase = await createClient();

    const { data: orgs, error: orgsError } = await supabase
      .from("organisations")
      .select("id, owner_id, legal_name")
      .in("id", args.organisationIds)
      .returns<{ id: string; owner_id: string | null; legal_name: string | null }[]>();
    if (orgsError) {
      await reportError(orgsError, {
        operation: "clients.bulk_note_notify_owner_lookup",
        selectedCount: args.organisationIds.length,
      });
      return;
    }

    const noteIdByOrg = new Map(args.noteRows.map((row) => [row.organisation_id, row.id]));
    const clients = (orgs ?? []).map((org) => ({
      organisationId: org.id,
      organisationName: org.legal_name?.trim() || "A client",
      ownerId: org.owner_id,
    }));
    const body = summariseNoteContent(args.content);

    const requested = sanitizeMentionedUsers(args.mentionedUsers, args.authorId);
    // Same binding as the single-note producer: the submitted name (the text
    // actually in the comment, surviving a rename between composing and
    // saving) matched against the text, the id verified still active.
    let activeMentionIds: string[] = [];
    if (requested.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id")
        .in(
          "id",
          requested.map((r) => r.id),
        )
        .eq("is_active", true)
        .returns<{ id: string }[]>();
      if (usersError) {
        await reportError(usersError, {
          operation: "clients.bulk_note_notify_mention_lookup",
          selectedCount: args.organisationIds.length,
        });
      } else {
        const active = new Set((users ?? []).map((u) => u.id));
        activeMentionIds = limitMentionIdsByOccurrences(
          args.content,
          requested.filter((r) => active.has(r.id)),
        );
      }
    }
    const mentionedOwners = new Set(activeMentionIds);

    type Job = {
      recipientId: string;
      type: string;
      title: string;
      linkPath: string;
      targetId: string | null;
    };
    const jobs: Job[] = [];

    // Owner half, grouped by owner. A single held client reads exactly like
    // the single-note flow (naming the client, linking to its notes, and
    // pointing at the note row); several collapse into one row naming the
    // count. An owner who was also @mentioned gets the mention instead —
    // the mention carries the signal and a second row would be noise.
    for (const [ownerId, held] of groupBulkClientsByOwner(clients, args.authorId)) {
      if (mentionedOwners.has(ownerId)) continue;
      if (held.length === 1 && held[0]) {
        const sole = held[0];
        jobs.push({
          recipientId: ownerId,
          type: NOTE_ADDED_NOTIFICATION_TYPE,
          title: buildOwnerNoteTitle(args.authorName, sole.organisationName),
          linkPath: noteNotificationLinkPath(sole.organisationId),
          targetId: noteIdByOrg.get(sole.organisationId) ?? null,
        });
      } else {
        jobs.push({
          recipientId: ownerId,
          type: NOTE_ADDED_NOTIFICATION_TYPE,
          title: buildBulkOwnerGroupTitle(args.authorName, held.length),
          linkPath: bulkNotificationLinkPath(),
          targetId: null,
        });
      }
    }

    // Mention half: one notification per mentioned user over the whole
    // batch, not one per client — each mentioned user is notified even when
    // they own none of the clients.
    const commentedCount = args.organisationIds.length;
    const soleClient = commentedCount === 1 ? clients.find((c) => c.organisationId === args.organisationIds[0]) : undefined;
    for (const recipientId of activeMentionIds) {
      if (soleClient) {
        jobs.push({
          recipientId,
          type: NOTE_MENTIONED_NOTIFICATION_TYPE,
          title: buildMentionNoteTitle(args.authorName, soleClient.organisationName),
          linkPath: noteNotificationLinkPath(soleClient.organisationId),
          targetId: noteIdByOrg.get(soleClient.organisationId) ?? null,
        });
      } else {
        jobs.push({
          recipientId,
          type: NOTE_MENTIONED_NOTIFICATION_TYPE,
          title: buildBulkMentionTitle(args.authorName, commentedCount),
          linkPath: bulkNotificationLinkPath(),
          targetId: null,
        });
      }
    }

    // Bounded concurrency: a 500-client batch could otherwise hold the
    // response behind hundreds of sequential RPC round trips, while one
    // giant Promise.all would hammer the pool. Either way a single
    // recipient's failure never cancels the rest.
    const CONCURRENCY = 20;
    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      const batch = jobs.slice(i, i + CONCURRENCY);
      const outcomes = await Promise.allSettled(
        batch.map((job) =>
          supabase.rpc("create_notification", {
            p_recipient_user_id: job.recipientId,
            p_notification_type: job.type,
            p_title: job.title,
            p_body: body,
            p_link_path: job.linkPath,
            p_target_table: job.targetId ? "notes" : null,
            p_target_id: job.targetId,
            p_actor_user_id: args.authorId,
          }),
        ),
      );
      outcomes.forEach((outcome, index) => {
        const job = batch[index];
        const rpcError =
          outcome.status === "rejected"
            ? outcome.reason
            : (outcome.value as { error?: unknown }).error;
        if (rpcError && job) {
          void reportError(rpcError, {
            operation: "clients.bulk_note_notify_create",
            notificationType: job.type,
            recipientId: job.recipientId,
            selectedCount: args.organisationIds.length,
          });
        }
      });
    }
  } catch (error) {
    await reportError(error, {
      operation: "clients.bulk_note_notify",
      selectedCount: args.organisationIds.length,
    });
  }
}
