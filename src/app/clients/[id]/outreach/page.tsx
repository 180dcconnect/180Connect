import { Clock, Mail, Paperclip, Reply, StickyNote } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { onFileEmail } from "@/lib/client-email-validation";
import { hasPermission } from "@/lib/auth/permissions";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";
import {
  buildEmailThread,
  splitOutreachHistory,
  type OutreachMessageRow,
  type ThreadReplyRow,
} from "@/lib/outreach-history";
import { deriveSourcesFromSavedRow } from "@/lib/booklet/sources";
import {
  emailSendWindowStart,
  isNearSendLimit,
  resolveEmailSendLimit,
} from "@/lib/outreach/send-rate-limit";
import { formatAttachments, type AttachmentRow } from "@/lib/attachments";
import { buildNoteList, type NoteRow } from "@/lib/note-history";
import { Group, Rise, Stage } from "@/components/dashboard-stage";

import { AddNoteForm } from "../add-note-form";
import { AttachmentsSection } from "../attachments-section";
import { BookletPanel } from "../booklet-panel";
import { ComposeButton } from "../compose-button";
import { FailedEmailList } from "../failed-email-list";
import { FollowUpButton } from "../follow-up-button";
import { NotesSection } from "../notes-section";
import { OutreachHistorySection } from "../outreach-history";
import { ScheduledEmailList } from "../scheduled-email-list";
import { SectionCard } from "../section-card";
import { UploadAttachmentForm } from "../upload-attachment-form";
import {
  loadClient,
  loadOwner,
  loadSuppression,
  requireActor,
} from "../load-record";

// F086: how many past versions the tab prefetches. Capped rather than
// unbounded — a client regenerated many times over months does not need its
// entire history loaded on every view; recent history is what a CAM compares.
const BOOKLET_HISTORY_LIMIT = 20;

type SavedBookletRow = {
  id: string;
  booklet_text: string;
  website_url: string | null;
  website_context_used: boolean;
  generated_at: string;
};
type ScheduledEmailRow = { id: string; subject: string; scheduled_at: string };
type FailedEmailRow = { id: string; subject: string; updated_at: string };

/**
 * The **Outreach** tab — everything that sends, or has sent, or failed to send.
 *
 * On the old single page this was scattered: the booklet and the Stage 1 email
 * were cards five and six in the left column, the queued and failed lists hung
 * off the compose card, and the history plus the follow-up trigger sat in a
 * completely separate "Outreach" card in the right-hand column. Two of those
 * cards both rendered `id="outreach-heading"`, which is why the old anchor
 * rail's "Outreach" link went to the wrong one.
 *
 * The gate to be careful about is suppression: `ComposeButton` and
 * `FollowUpButton` render a blocked state from it, and the routes behind them
 * re-check it server-side regardless. The banner explaining *why* lives in the
 * shell, above the tab bar, so it is read before this tab is reached.
 */
export default async function ClientOutreachPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const client = await loadClient(id);
  const supabase = await createClient();

  const canContact = hasPermission(actor.role, "client:contact");
  const canEdit = hasPermission(actor.role, "client:edit");
  const isAdmin = actor.role === "admin";

  const [
    owner,
    suppression,
    bookletResult,
    outreachResult,
    scheduledResult,
    failedResult,
    replyResult,
    notesResult,
    attachmentsResult,
  ] =
    await Promise.all([
      loadOwner(id),
      loadSuppression(id),
      // F085/F086: every saved version, most recent first, so BookletPanel can
      // render the current one immediately (no fresh, billed Gemini call on
      // open) and list the rest as a timeline a CAM can browse.
      supabase
        .from("client_booklets")
        .select("id, booklet_text, website_url, website_context_used, generated_at")
        .eq("organisation_id", id)
        .order("generated_at", { ascending: false })
        .limit(BOOKLET_HISTORY_LIMIT)
        .returns<SavedBookletRow[]>(),
      // F070: every outreach message for this client, sent or not. The sender
      // join backs F125's "record who sent it" attribution in the Sent list.
      supabase
        .from("outreach_messages")
        .select(
          "id, subject, body, send_status, sent_at, scheduled_at, created_at, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)",
        )
        .eq("organisation_id", id)
        .order("created_at", { ascending: false }),
      // F126: emails queued for future delivery. Ascending — the next one due
      // is the one a CAM most needs to see.
      supabase
        .from("outreach_messages")
        .select("id, subject, scheduled_at")
        .eq("organisation_id", id)
        .eq("send_status", "scheduled")
        .order("scheduled_at", { ascending: true })
        .returns<ScheduledEmailRow[]>(),
      // F129: sends that did not leave, newest first.
      supabase
        .from("outreach_messages")
        .select("id, subject, updated_at")
        .eq("organisation_id", id)
        .eq("send_status", "failed")
        .order("updated_at", { ascending: false })
        .returns<FailedEmailRow[]>(),
      // F134: replies, for the conversation view. The overview page fetched
      // these before the tab split moved everything outreach here; RLS scopes
      // them by the same active-user rule as the messages themselves, so this
      // opens no wider access path.
      supabase
        .from("reply_events")
        .select("id, outreach_message_id, reply_body, received_at")
        .eq("organisation_id", id)
        .returns<ThreadReplyRow[]>(),
      // F071–F074: notes left against this client.
      supabase
        .from("notes")
        .select(
          "id, content, created_at, updated_at, author_id, author:users!notes_author_id_fkey(full_name)",
        )
        .eq("organisation_id", id),
      // F080/F081: attachments uploaded to this client.
      supabase
        .from("attachments")
        .select(
          "id, filename, content_type, size_bytes, created_at, uploaded_by_user:users!attachments_uploaded_by_fkey(full_name)",
        )
        .eq("organisation_id", id)
        .order("created_at", { ascending: false }),
    ]);

  for (const [operation, error] of [
    ["clients.detail_saved_booklet", bookletResult.error],
    ["clients.detail_outreach", outreachResult.error],
    ["clients.detail_scheduled_emails", scheduledResult.error],
    ["clients.detail_failed_emails", failedResult.error],
    ["clients.detail_replies", replyResult.error],
    ["clients.detail_notes", notesResult.error],
    ["clients.detail_attachments", attachmentsResult.error],
  ] as const) {
    if (error) await reportError(error, { operation, organisationId: id });
  }

  const noteList = buildNoteList((notesResult.data ?? []) as unknown as NoteRow[], {
    id: actor.id,
    role: actor.role,
  });
  const attachments = formatAttachments(
    (attachmentsResult.data ?? []) as unknown as AttachmentRow[],
  );

  const savedBooklet = bookletResult.data?.[0] ?? null;
  const outreachHistory = splitOutreachHistory(
    // `as unknown` — supabase-js infers the users join as an array.
    (outreachResult.data ?? []) as unknown as OutreachMessageRow[],
  );

  // F134: only delivered messages belong in the client-visible conversation;
  // drafts, scheduled messages and failures stay in the F070 list above it.
  const emailThread = buildEmailThread(
    outreachHistory.sent,
    replyResult.data ?? [],
  );

  // F129: the reason comes from the newest SEND_EVENTS 'failed' record per
  // message — two queries, because send_events has no "latest per group" join,
  // so the pick happens here.
  const failedEmailIds = (failedResult.data ?? []).map((row) => row.id);
  const failureReasons = new Map<string, string>();
  if (failedEmailIds.length > 0) {
    const { data: events, error } = await supabase
      .from("send_events")
      .select("outreach_message_id, metadata, occurred_at")
      .in("outreach_message_id", failedEmailIds)
      .eq("event_type", "failed")
      .order("occurred_at", { ascending: false });
    if (error) {
      await reportError(error, {
        operation: "clients.detail_failed_email_events",
        organisationId: id,
      });
    }
    for (const event of events ?? []) {
      if (failureReasons.has(event.outreach_message_id)) continue;
      const reason =
        event.metadata &&
        typeof event.metadata === "object" &&
        typeof event.metadata.reason === "string"
          ? event.metadata.reason
          : "The email could not be sent.";
      failureReasons.set(event.outreach_message_id, reason);
    }
  }
  const failedEmails = (failedResult.data ?? []).map((row) => ({
    id: row.id,
    subject: row.subject,
    reason: failureReasons.get(row.id) ?? "The email could not be sent.",
  }));

  // F165: warn the CAM up front when the client they are viewing is owned by
  // someone else, so the compose flow explains a block the route would enforce.
  const ownershipConflict = checkOwnershipConflict({
    ownerId: owner.ownerId,
    ownerName: owner.ownerName,
    actorId: actor.id,
    actorRole: actor.role,
  });

  // F101: the follow-up trigger only exists while the client sits at
  // initial_outreach_sent — Stage 1 sent, nothing since. The route
  // re-enforces eligibility server-side, so this gate is convenience over an
  // enforcement that does not depend on it.
  const canFollowUp =
    canContact && client.outreach_status === "initial_outreach_sent";
  const followUpBlocked =
    suppression.suppressed || ownershipConflict.hasConflict;

  // The queue card only exists when there is something queued or failed —
  // the lists render nothing on empty, and a card around two nothings would
  // be a heading with no body.
  const hasQueue =
    (scheduledResult.data?.length ?? 0) > 0 || failedEmails.length > 0;

  // F228: the admin sees their own position against the F227 send limit, so the
  // warning arrives before sends start failing rather than after. Counted
  // per-sender, from the same audited sent_at window the enforcement counts.
  let sendingVolume: {
    count: number;
    limit: number;
    warning: boolean;
    windowMinutes: number;
  } | null = null;
  if (isAdmin) {
    const limit = resolveEmailSendLimit();
    const { count, error } = await supabase
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("sent_by_user_id", actor.id)
      .eq("send_status", "sent")
      .gte("sent_at", emailSendWindowStart(limit.windowSeconds));
    if (error) {
      await reportError(error, { operation: "clients.detail_sending_volume" });
    }
    if (count !== null) {
      sendingVolume = {
        count,
        limit: limit.maximum,
        warning: isNearSendLimit(count, limit.maximum),
        windowMinutes: Math.ceil(limit.windowSeconds / 60),
      };
    }
  }

  // F119: the most recent still-unsent draft, so ComposeButton can reopen it
  // exactly as it was saved instead of always starting blank. A separate query
  // (not reused from the history above) because it needs contact_id.
  //
  // Gated on not_contacted deliberately: stage-two drafts can only ever be
  // created while the client sits at initial_outreach_sent, so outside
  // not_contacted the newest draft row may be a follow-up — and reopening that
  // in the Stage 1 card would let "Save draft" overwrite a follow-up's content
  // with Stage 1 state.
  let existingDraft: {
    id: string;
    subject: string;
    body: string;
    savedRecipient: string | null;
    recipientOnFile: string | null;
  } | null = null;
  if (client.outreach_status === "not_contacted") {
    const { data: draftRow, error } = await supabase
      .from("outreach_messages")
      .select("id, subject, body, sent_to_email, contact_id")
      .eq("organisation_id", id)
      .eq("send_status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        subject: string;
        body: string;
        sent_to_email: string | null;
        contact_id: string | null;
      }>();
    if (error) {
      await reportError(error, {
        operation: "clients.detail_existing_draft",
        organisationId: id,
      });
    }
    if (draftRow) {
      let contactEmail: string | null = null;
      if (draftRow.contact_id) {
        const { data: draftContact } = await supabase
          .from("contacts")
          .select("email")
          .eq("id", draftRow.contact_id)
          .maybeSingle<{ email: string | null }>();
        contactEmail = draftContact?.email ?? null;
      }
      existingDraft = {
        id: draftRow.id,
        subject: draftRow.subject,
        body: draftRow.body,
        // F119 AC1/AC2: the recipient reopens exactly as saved — a reviewed
        // override must survive the round-trip, not be recomputed from
        // contacts.email. The on-file address stays separate purely as the
        // mismatch-warning baseline (F116 AC3).
        savedRecipient: draftRow.sent_to_email?.trim() || null,
        // A redacted contact_email is not an address on file — see onFileEmail.
        recipientOnFile: contactEmail?.trim() || onFileEmail(client.contact_email) || null,
      };
    }
  }

  return (
    <Stage>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Group className="space-y-6">
          {canContact ? (
            <>
              {/* F082 — Generate Client Booklet. First, because a CAM reads the
                  research before writing the email below it. The Rise carries
                  z-index so the composer's search panel paints over the card
                  beneath it — `relative z-20` is what orders them, not the
                  entrance's filter, which `glass` removes: the composer's
                  frosted panel can only blur the page if no ancestor holds a
                  filter (see Rise). */}
              <Rise glass className="relative z-20">
                <BookletPanel
                  organisationId={client.id}
                  canDeleteBooklet={actor.role === "admin"}
                  savedBooklet={
                    savedBooklet && {
                      id: savedBooklet.id,
                      text: savedBooklet.booklet_text,
                      websiteUrl: savedBooklet.website_url,
                      websiteContextUsed: savedBooklet.website_context_used,
                      generatedAt: savedBooklet.generated_at,
                      // F087: reconstructed from the stored used/not-used
                      // boolean and URL — see sources.ts for why this cannot
                      // drift from what a fresh generation reports.
                      sources: deriveSourcesFromSavedRow({
                        websiteContextUsed: savedBooklet.website_context_used,
                        websiteUrl: savedBooklet.website_url,
                      }),
                    }
                  }
                  priorVersions={(bookletResult.data ?? []).slice(1).map((version) => ({
                    id: version.id,
                    text: version.booklet_text,
                    websiteUrl: version.website_url,
                    websiteContextUsed: version.website_context_used,
                    generatedAt: version.generated_at,
                    sources: deriveSourcesFromSavedRow({
                      websiteContextUsed: version.website_context_used,
                      websiteUrl: version.website_url,
                    }),
                  }))}
                />
              </Rise>

              <Rise>
                <ComposeButton
                  blocked={suppression.suppressed}
                  ownershipBlocked={!suppression.suppressed && ownershipConflict.hasConflict}
                  historyHref={
                    hasPermission(actor.role, "platform-settings:manage")
                      ? `/admin/ai-generations?client=${client.id}`
                      : undefined
                  }
                  organisationId={client.id}
                  suppressionReason={
                    suppression.suppressed ? suppression.latest?.reason : undefined
                  }
                  ownershipWarning={
                    ownershipConflict.hasConflict ? ownershipConflict.warning : undefined
                  }
                  hasSavedBooklet={savedBooklet !== null}
                  existingDraft={existingDraft}
                />
              </Rise>

              {/* What is waiting to go out, and what failed to leave — with
                  cancel and retry where each was created. One card rather
                  than two orphan lists, so the queue reads as one state. */}
              {hasQueue && (
                <Rise>
                  <SectionCard
                    headingId="outreach-queue-heading"
                    title="Queued and failed"
                    hint="Scheduled sends waiting to go out, and sends that failed to leave."
                    icon={<Clock />}
                  >
                    <ScheduledEmailList
                      organisationId={client.id}
                      messages={scheduledResult.data ?? []}
                    />
                    <FailedEmailList organisationId={client.id} messages={failedEmails} />
                  </SectionCard>
                </Rise>
              )}
            </>
          ) : (
            <Rise>
              <SectionCard
                headingId="outreach-compose-heading"
                title="Sending"
                hint="Your role can read this client's outreach history but not send to it."
                icon={<Mail />}
              />
            </Rise>
          )}
        </Group>

        <Group className="space-y-6">
          {/* F070: the history itself is readable by every active role
              (outreach_messages_select_active), so the card is not gated on
              client:contact — only the actions above and the follow-up below
              are. */}
          <Rise>
            <SectionCard
              headingId="outreach-history-heading"
              title="Outreach history"
              hint="Sent emails, client replies and everything still unsent."
              icon={<Mail />}
            >
              {sendingVolume && (
                <p
                  className={`mt-3 rounded-inset p-3 text-sm font-medium ${
                    sendingVolume.warning
                      ? "bg-hold-wash text-hold"
                      : "bg-paper text-dim"
                  }`}
                  role={sendingVolume.warning ? "alert" : "status"}
                >
                  Your sending volume: {sendingVolume.count} of your {sendingVolume.limit}{" "}
                  emails in the current {sendingVolume.windowMinutes}-minute window.
                  {sendingVolume.warning
                    ? " You are close to the configured threshold; sends are refused once it is reached."
                    : ""}
                </p>
              )}
              <OutreachHistorySection
                history={outreachHistory}
                error={Boolean(outreachResult.error)}
                thread={emailThread}
                threadError={Boolean(outreachResult.error || replyResult.error)}
                // F136: a note written against a reply is linked to it, so only
                // someone who may write to the record gets the composer.
                noteOrganisationId={canEdit ? client.id : undefined}
              />
            </SectionCard>
          </Rise>

          {/* Stage 2 gets its own card rather than living as a footnote
              inside the history: it exists at exactly one pipeline stage,
              and it is an action, not history. */}
          {canFollowUp && (
            <Rise>
              <SectionCard
                headingId="outreach-followup-heading"
                title="Follow-up"
                hint="One follow-up email, available while the first email is out and unanswered."
                icon={<Reply />}
                tone={followUpBlocked ? "danger" : "default"}
              >
                <FollowUpButton
                  blocked={suppression.suppressed}
                  ownershipBlocked={!suppression.suppressed && ownershipConflict.hasConflict}
                  organisationId={client.id}
                  suppressionReason={
                    suppression.suppressed ? suppression.latest?.reason : undefined
                  }
                  ownershipWarning={
                    ownershipConflict.hasConflict ? ownershipConflict.warning : undefined
                  }
                />
              </SectionCard>
            </Rise>
          )}

          <Rise className="relative z-30">
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

          <Rise className="relative z-10">
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
