import { History } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { buildTimeline, collectReferencedUserIds, type AuditRow, type NoteRow as TimelineNoteRow, type OutreachMessageRow as TimelineOutreachRow, type ReplyEventRow } from "@/lib/timeline";
import {
  stageEventsFromAudit,
  type MissionHistoryRow,
} from "@/lib/field-sources";
import { Group, Rise, Stage } from "@/components/dashboard-stage";

import { SectionCard } from "../section-card";
import { TimelineSection } from "../timeline-section";
import { loadFieldHistory, requireActor } from "../load-record";
import { WhatCameFromWhereCard } from "../what-came-from-where-card";

/** The audit actions the client timeline surfaces. */
const TIMELINE_AUDIT_ACTIONS = [
  "status_changed",
  "ownership_reassigned",
  "edit_suggestion_approved",
  "edit_suggestion_rejected",
] as const;

/**
 * F075/F076 timeline + provenance — the **Activity** tab: what has happened
 * to this record, and what came from where.
 *
 * The timeline reads across every other tab — emails, replies, notes, status,
 * ownership — so it gets the wide column, with provenance beside it.
 */
export default async function ClientActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireActor();
  const supabase = await createClient();

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
  const [timelineNotes, timelineMessages, replies, audit, fieldHistory] =
    await Promise.all([
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
      // cache()d: the Overview tab's Data Sources card shares the same
      // provenance query, so a session that has already loaded it pays
      // nothing again here.
      loadFieldHistory(id),
    ]);

  for (const [operation, error] of [
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
  // See collectReferencedUserIds (@/lib/timeline.ts) for why this cannot treat
  // every detail.from/detail.to as a user id: for status_changed they are
  // pipeline-status tokens, and passing one to the uuid `users.id` filter fails
  // the whole names lookup.
  const referencedUserIds = collectReferencedUserIds((audit.data ?? []) as AuditRow[]);

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

  /*
   * Mission history for the what-came-from-where card: ENRICHMENT_RESULTS is
   * append-only (latest row wins), so the mission's own table IS its history —
   * no second tracking layer. RLS (enrichment_results_select_active) already
   * shows these rows to every active role, so the card needs no widening.
   */
  const missionResult = await supabase
    .from("enrichment_results")
    .select("id, mission_statement, enriched_at, confidence_score")
    .eq("organisation_id", id)
    .order("enriched_at", { ascending: false })
    .limit(24);
  if (missionResult.error) {
    await reportError(missionResult.error, {
      operation: "clients.activity_mission_history",
      organisationId: id,
    });
  }
  const missionHistory = (missionResult.data ?? []) as MissionHistoryRow[];

  const timeline = buildTimeline(
    {
      notes: (timelineNotes.data ?? []) as unknown as TimelineNoteRow[],
      outreachMessages: (timelineMessages.data ?? []) as unknown as TimelineOutreachRow[],
      replyEvents: (replies.data ?? []) as unknown as ReplyEventRow[],
      auditRows: (audit.data ?? []) as unknown as AuditRow[],
    },
    timelineNames,
  );

  // The stage column of the what-came-from-where card reads the same audit
  // rows the timeline does — one query serves both, and the actor names are
  // the map resolved above, so a person reads as a person in both places.
  const stageEvents = stageEventsFromAudit(audit.data ?? [], timelineNames);

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
          <Rise className="relative z-10">
            {/* z-10 as on Overview's TagsCard: this card holds popovers that
                must paint over the Rise below it, and each Rise is its own
                stacking context. */}
            <WhatCameFromWhereCard
              provenance={fieldHistory.provenance}
              missionRows={missionHistory}
              stageEvents={stageEvents}
              error={fieldHistory.error}
            />
          </Rise>
        </Group>
      </div>
    </Stage>
  );
}
