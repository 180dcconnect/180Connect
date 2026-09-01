import { History, Paperclip, StickyNote } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { hasPermission } from "@/lib/auth/permissions";
import { formatAttachments, type AttachmentRow } from "@/lib/attachments";
import { buildNoteList, type NoteRow } from "@/lib/note-history";
import {
  buildTimeline,
  type AuditRow,
  type NoteRow as TimelineNoteRow,
  type OutreachMessageRow as TimelineOutreachRow,
  type ReplyEventRow,
} from "@/lib/timeline";
import { Group, Rise, Stage } from "@/components/dashboard-stage";

import { AddNoteForm } from "../add-note-form";
import { AttachmentsSection } from "../attachments-section";
import { NotesSection } from "../notes-section";
import { SectionCard } from "../section-card";
import { TimelineSection } from "../timeline-section";
import { UploadAttachmentForm } from "../upload-attachment-form";
import { loadClient, requireActor } from "../load-record";

/** The audit actions the client timeline surfaces. */
const TIMELINE_AUDIT_ACTIONS = [
  "status_changed",
  "ownership_reassigned",
  "edit_suggestion_approved",
  "edit_suggestion_rejected",
] as const;

/**
 * F075/F076 timeline + F071–F074 notes + F080/F081 attachments — the
 * **Activity** tab: what has happened to this record, and what people have
 * attached to it.
 *
 * The timeline reads across every other tab — emails, replies, notes, status,
 * ownership — so it gets the wide column, with notes and files beside it. On the
 * old single page it was pinned full-width at the very bottom, below sixteen
 * cards, and notes were the last card of the left column above it.
 */
export default async function ClientActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const client = await loadClient(id);
  const supabase = await createClient();

  const canEdit = hasPermission(actor.role, "client:edit");

  /*
   * The timeline's four sources are independent queries, not one join — the
   * tables share no join key that would make sense together (notes,
   * outreach_messages and reply_events key off organisation_id; audit_log keys
   * off target_table + target_id). Each fails independently: `timelineDegraded`
   * downgrades the section to a warning above whatever did load, because a
   * notes-query failure should not hide the emails and replies that arrived.
   *
   * RLS (audit_log_select_client_timeline) is what makes the audit rows readable
   * by a CAM or viewer at all — without it every row is invisible, not merely
   * filtered, to anyone but an admin.
   */
  const [notesResult, attachmentsResult, timelineNotes, timelineMessages, replies, audit] =
    await Promise.all([
      supabase
        .from("notes")
        .select(
          "id, content, created_at, updated_at, author_id, author:users!notes_author_id_fkey(full_name)",
        )
        .eq("organisation_id", id),
      supabase
        .from("attachments")
        .select(
          "id, filename, content_type, size_bytes, created_at, uploaded_by_user:users!attachments_uploaded_by_fkey(full_name)",
        )
        .eq("organisation_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("notes")
        .select(
          "id, content, created_at, updated_at, author:users!notes_author_id_fkey(full_name)",
        )
        .eq("organisation_id", id),
      supabase
        .from("outreach_messages")
        .select(
          "id, subject, send_status, sent_at, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)",
        )
        .eq("organisation_id", id),
      supabase
        .from("reply_events")
        .select("id, reply_body, received_at")
        .eq("organisation_id", id),
      supabase
        .from("audit_log")
        .select("id, actor_user_id, action, detail, created_at")
        .eq("target_table", "organisations")
        .eq("target_id", id)
        .in("action", [...TIMELINE_AUDIT_ACTIONS]),
    ]);

  for (const [operation, error] of [
    ["clients.detail_notes", notesResult.error],
    ["clients.detail_attachments", attachmentsResult.error],
    ["clients.timeline_notes", timelineNotes.error],
    ["clients.timeline_messages", timelineMessages.error],
    ["clients.timeline_replies", replies.error],
    ["clients.timeline_audit", audit.error],
  ] as const) {
    if (error) await reportError(error, { operation, organisationId: id });
  }

  const timelineDegraded = Boolean(
    timelineNotes.error || timelineMessages.error || replies.error || audit.error,
  );

  /*
   * actor_user_id and detail.from/detail.to are bare uuids (detail is jsonb, not
   * a foreign key PostgREST can embed), so they are resolved by hand in one
   * batch rather than per-row. A name missing from this map — a deleted account,
   * or a uuid audit_log carries no FK constraint to validate — reads as "A
   * former team member" in @/lib/timeline.ts, never as a raw id or blank.
   */
  const referencedUserIds = new Set<string>();
  for (const row of audit.data ?? []) {
    if (row.actor_user_id) referencedUserIds.add(row.actor_user_id);
    const detail = row.detail && typeof row.detail === "object" ? (row.detail as Record<string, unknown>) : null;
    for (const key of ["from", "to", "requested_by"] as const) {
      const value = detail?.[key];
      if (typeof value === "string") referencedUserIds.add(value);
    }
  }

  const timelineNames = new Map<string, string | null>();
  if (referencedUserIds.size > 0) {
    const { data: referencedUsers, error } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", Array.from(referencedUserIds));
    if (error) {
      await reportError(error, { operation: "clients.timeline_names", organisationId: id });
    }
    for (const row of referencedUsers ?? []) {
      timelineNames.set(row.id, row.full_name);
    }
  }

  const timeline = buildTimeline(
    {
      notes: (timelineNotes.data ?? []) as unknown as TimelineNoteRow[],
      outreachMessages: (timelineMessages.data ?? []) as unknown as TimelineOutreachRow[],
      replyEvents: (replies.data ?? []) as unknown as ReplyEventRow[],
      auditRows: (audit.data ?? []) as unknown as AuditRow[],
    },
    timelineNames,
  );

  const noteList = buildNoteList((notesResult.data ?? []) as unknown as NoteRow[], {
    id: actor.id,
    role: actor.role,
  });
  const attachments = formatAttachments(
    (attachmentsResult.data ?? []) as unknown as AttachmentRow[],
  );

  return (
    <Stage>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Group className="space-y-6">
          <Rise>
            <SectionCard
              headingId="timeline-heading"
              title="Timeline"
              hint="Every email, reply, note and change for this client, in one place."
              icon={<History />}
            >
              <TimelineSection entries={timeline} degraded={timelineDegraded} />
            </SectionCard>
          </Rise>
        </Group>

        <Group className="space-y-6">
          <Rise>
            {/* Add note rides the heading row, so the composer opens downward
                over the list rather than pushing it — see add-note-form.tsx. */}
            <SectionCard
              action={canEdit ? <AddNoteForm organisationId={client.id} /> : undefined}
              headingId="notes-heading"
              title="Notes"
              hint="Left by any team member — relationship history everyone can see."
              icon={<StickyNote />}
            >
              <NotesSection
                notes={noteList}
                error={Boolean(notesResult.error)}
                organisationId={client.id}
              />
            </SectionCard>
          </Rise>

          <Rise>
            <SectionCard
              headingId="attachments-heading"
              title="Attachments"
              hint="Files attached to this client."
              icon={<Paperclip />}
            >
              <AttachmentsSection
                organisationId={client.id}
                attachments={attachments}
                error={Boolean(attachmentsResult.error)}
              />
              {/* F081: upload sits inside the same card so the new file appears
                  in the list directly above it on refresh (AC4). */}
              {canEdit && <UploadAttachmentForm organisationId={client.id} />}
            </SectionCard>
          </Rise>
        </Group>
      </div>
    </Stage>
  );
}
