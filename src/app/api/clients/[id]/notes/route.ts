import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { isUuid, nonEmptyTrimmed, safeValidate } from "@/lib/validation";
import { buildReplyNoteContent } from "@/lib/reply-note";
import {
  MAX_MENTIONS_PER_NOTE,
  NOTE_ADDED_NOTIFICATION_TYPE,
  NOTE_MENTIONED_NOTIFICATION_TYPE,
  buildMentionNoteTitle,
  buildOwnerNoteTitle,
  noteNotificationLinkPath,
  ownerAlreadyMentioned,
  resolveMentionRecipientIds,
  shouldNotifyOwner,
  summariseNoteContent,
} from "@/lib/note-mentions";

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
  // F485: ids the composer resolved through the @mention autocomplete
  // (active users, not freehand names). Routing on explicit ids — never on
  // parsing `@Name` out of the text — is what keeps an email address or a
  // bare `@` from becoming a notification. Elements are plain strings here,
  // not `z.uuid()`: a malformed id is dropped by
  // `resolveMentionRecipientIds`, never a reason to reject the note itself.
  mentionedUserIds: z.array(z.string()).max(MAX_MENTIONS_PER_NOTE).optional(),
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

  // F485 — best-effort fan-out beside the insert, never a trigger (see the
  // file header). A notification failure must never fail the note that
  // caused it: the note is saved above, and everything below only reports.
  await notifyNoteRecipients({
    organisationId,
    noteId: (data as { id: string }).id,
    content,
    authorId: authorization.actor.id,
    authorName: authorization.actor.fullName?.trim() || "A team member",
    mentionedUserIds: parsed.data.mentionedUserIds ?? [],
  });

  return NextResponse.json({ note: data }, { status: 201 });
}

/**
 * F485 producer: owner notification + @mention notifications for one saved
 * note. Never throws — every failure is reported (ERROR_LOG via
 * `reportError`) and swallowed, so the note itself always survives.
 *
 * Permission posture: organisations and notes are shared-read across all
 * active roles, so "could already read that client" reduces to `is_active`
 * today — enforced by filtering mentioned ids against active users here
 * *and* by `create_notification` itself, which skips inactive recipients.
 * Should read ever scope per-user, this is the place that must learn the
 * narrower check; the notification body (a 240-char preview) must never go
 * somewhere the full note could not be opened.
 */
async function notifyNoteRecipients(args: {
  organisationId: string;
  noteId: string;
  content: string;
  authorId: string;
  authorName: string;
  mentionedUserIds: string[];
}): Promise<void> {
  try {
    const supabase = await createClient();

    const { data: org, error: orgError } = await supabase
      .from("organisations")
      .select("owner_id, legal_name")
      .eq("id", args.organisationId)
      .maybeSingle<{ owner_id: string | null; legal_name: string | null }>();
    if (orgError) {
      await reportError(orgError, {
        operation: "clients.notes_notify_owner_lookup",
        organisationId: args.organisationId,
      });
      return;
    }
    if (!org) return;

    const organisationName = org.legal_name?.trim() || "A client";
    const linkPath = noteNotificationLinkPath(args.organisationId);
    const body = summariseNoteContent(args.content);
    const mentionIds = resolveMentionRecipientIds(args.mentionedUserIds, args.authorId);

    // Only active users are notifiable. `create_notification` re-checks
    // this itself; filtering first keeps the intent (and the per-id error
    // attribution) in this file rather than only in the migration.
    let activeMentionIds = mentionIds;
    if (mentionIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id")
        .in("id", mentionIds)
        .eq("is_active", true)
        .returns<{ id: string }[]>();
      if (usersError) {
        await reportError(usersError, {
          operation: "clients.notes_notify_mention_lookup",
          organisationId: args.organisationId,
        });
        activeMentionIds = [];
      } else {
        const active = new Set((users ?? []).map((u) => u.id));
        activeMentionIds = mentionIds.filter((id) => active.has(id));
      }
    }

    const jobs: { recipientId: string; type: string; title: string }[] = [];

    // Owner half: someone else noted on your client. Skipped when the owner
    // is also @mentioned — the mention carries the signal and a second row
    // about the same note would be noise.
    const ownerId = org.owner_id;
    if (
      shouldNotifyOwner(ownerId, args.authorId) &&
      ownerId !== null &&
      !ownerAlreadyMentioned(ownerId, activeMentionIds)
    ) {
      jobs.push({
        recipientId: ownerId,
        type: NOTE_ADDED_NOTIFICATION_TYPE,
        title: buildOwnerNoteTitle(args.authorName, organisationName),
      });
    }

    // Mention half: each mentioned user is notified even when they do not
    // own the client. The author can never appear here (resolved out
    // above), and inactive/unreadable users were filtered above.
    for (const recipientId of activeMentionIds) {
      jobs.push({
        recipientId,
        type: NOTE_MENTIONED_NOTIFICATION_TYPE,
        title: buildMentionNoteTitle(args.authorName, organisationName),
      });
    }

    for (const job of jobs) {
      const { error } = await supabase.rpc("create_notification", {
        p_recipient_user_id: job.recipientId,
        p_notification_type: job.type,
        p_title: job.title,
        p_body: body,
        p_link_path: linkPath,
        p_target_table: "notes",
        p_target_id: args.noteId,
        p_actor_user_id: args.authorId,
      });
      if (error) {
        // One recipient's failure must not cancel the rest — continue the
        // fan-out and record each failure with its own recipient.
        await reportError(error, {
          operation: "clients.notes_notify_create",
          organisationId: args.organisationId,
          notificationType: job.type,
          recipientId: job.recipientId,
        });
      }
    }
  } catch (error) {
    await reportError(error, {
      operation: "clients.notes_notify",
      organisationId: args.organisationId,
    });
  }
}
