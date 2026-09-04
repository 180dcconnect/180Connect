import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";
import {
  buildEmailThread,
  splitOutreachHistory,
  type OutreachMessageRow,
  type ThreadReplyRow,
} from "@/lib/outreach-history";
import { validateClientEmail } from "@/lib/client-email-validation";
import {
  formatOrganisationSources,
  type OrganisationSourceRow,
} from "@/lib/source-tracking";
import { checkWebsiteReachabilityCached } from "@/lib/website-reachability-cache";
import { websiteHref } from "@/lib/website-validation";
import { formatLocation, formatOutreachStatus } from "@/lib/organisation-format";
import { ExternalLink } from "lucide-react";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import type { OrganisationDetailRow } from "@/lib/client-basic-info";
import { SuppressButton } from "./suppress-button";
import { ComposeButton } from "./compose-button";
import { FollowUpButton } from "./follow-up-button";
import { OutreachHistorySection } from "./outreach-history";
import { BasicInfoPanel } from "./basic-info-panel";
import { ClaimButton } from "./claim-button";
import { AssignOwnerForm } from "./assign-owner-form";
import { StatusSelect } from "./status-select";
import { Pill, SectionCard } from "./section-card";
import { ScoreBreakdownCard, type LatestScoreDetailRow } from "./score-breakdown";
import { TagsSection } from "./tags-section";
import { BookletPanel } from "./booklet-panel";
import { deriveSourcesFromSavedRow } from "@/lib/booklet/sources";
import { formatAttachments, type AttachmentRow } from "@/lib/attachments";
import { AttachmentsSection } from "./attachments-section";
import { UploadAttachmentForm } from "./upload-attachment-form";
import {
  EDIT_SUGGESTION_SELECT,
  type EditSuggestionRow,
  restrictedFieldLabel,
} from "@/lib/edit-suggestions";
import { SuggestEditSection } from "./suggest-edit-section";
import { buildNoteList, type NoteRow } from "@/lib/note-history";
import { NotesSection } from "./notes-section";
import { AddNoteForm } from "./add-note-form";
import {
  buildTimeline,
  buildTimelineLinkOptions,
  collectReferencedUserIds,
  type AuditRow,
  type NoteRow as TimelineNoteRow,
  type OutreachMessageRow as TimelineOutreachRow,
  type ReplyEventRow,
} from "@/lib/timeline";
import { TimelineSection } from "./timeline-section";
import { TimelineRealtimeRefresher } from "./timeline-realtime";
import { RequestOwnershipForm } from "./request-ownership-form";
import { ScheduledEmailList } from "./scheduled-email-list";
import { FailedEmailList } from "./failed-email-list";
import { emailSendWindowStart, isNearSendLimit, resolveEmailSendLimit } from "@/lib/outreach/send-rate-limit";
import { averageResponseTime, formatResponseTime } from "@/lib/reply-analytics";

type OrganisationRow = OrganisationDetailRow;
type EnrichmentRow = { mission_statement: string | null; enriched_at: string };
type SavedBookletRow = {
  id: string;
  booklet_text: string;
  website_url: string | null;
  website_context_used: boolean;
  generated_at: string;
};

// F086: how many past versions the page prefetches for the timeline. Capped
// rather than unbounded — a client regenerated many times over months does not
// need its entire history loaded on every page view; recent history is what a
// CAM actually compares against.
const BOOKLET_HISTORY_LIMIT = 20;
type LatestSuppression = {
  status: "pending" | "active" | "rejected" | "lifted";
  reason: string;
  created_at: string;
};
type OwnerRow = {
  owner_id: string | null;
  owner: { full_name: string | null } | null;
};
type SentEmailRow = {
  id: string;
  subject: string;
  body: string;
  sent_at: string;
  sent_by_user: { full_name: string | null } | null;
};
type ScheduledEmailRow = { id: string; subject: string; scheduled_at: string };
type FailedEmailRow = { id: string; subject: string; updated_at: string };

/**
 * F067 (#69) Client Detail Page / F068 (#70) View Client Basic Info: opens from the
 * charity list (F051) at /clients/[id] and shows that client's info in one place —
 * BasicInfoPanel below is the F068 basic-info section (AC1/AC2), and this route's
 * own not-found.tsx supplies F067 AC3's clear message for a deleted/merged client
 * id, instead of Next's generic 404. Sections beyond basic info (notes, timeline,
 * F069-081) are still separate open tickets; each will slot in here as its own
 * `<section aria-labelledby>`, same shape as "Record sources" and this one, to
 * keep F067 AC2's "each reachable without excessive scrolling" true as they land.
 *
 * Started as F251 AC1/AC2's minimal client screen (name + suppression state only)
 * — see src/app/clients/page.tsx for that history. Extended here, not replaced.
 *
 * Also F050 (#52): ComposeButton is a placeholder send action — no real outreach
 * feature exists yet (F094 #93, F100 #99 are both unbuilt). It exists so F050's
 * "blocked, not just discouraged" and "clear message when blocked" ACs can be
 * demonstrated end-to-end now, ahead of the real send UI. The gating check
 * (suppression status) is identical to the one already enforced at the RLS layer
 * (outreach_messages_insert_*, see 20260806120000) — when the real send screen
 * replaces this stub, it must reuse this same gate rather than reinvent it, or the
 * two can drift apart the way the admin RLS policy already once did.
 *
 * Also F254 (#51) AC1/AC4/AC5: this same suppress action is the "Do Not Contact"
 * flag — the charity-record wrapper F254 asks for. F254's AC3 ("takes effect with
 * no separate step") only holds for an admin's own call, which self-approves; a
 * CAM's flag still lands pending until an admin reviews it, same as any other
 * suppression request — deliberate per F251, not a gap. Scope note on #51.
 *
 * Also F162 (#157): the Ownership section is a separate query from BasicInfoPanel's
 * OrganisationDetailRow (same reason "Record sources" is separate — it isn't part
 * of F068's realtime-driven basic-info state). ClaimButton posts to
 * /api/clients/[id]/claim, which calls claim_organisation — see that RPC's header
 * (20260806140000_create_claim_organisation_rpc.sql) for why a direct owner_id write
 * is no longer possible for a CAM's own claim.
 */
export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authorization = await getCurrentActor("client:view", { route: "/clients/[id]" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const { id } = await params;
  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from("organisations")
    .select(
      "id, legal_name, organisation_type, website, contact_email, address_line_1, city, postcode, country_code, outreach_status",
    )
    .eq("id", id)
    .maybeSingle<OrganisationRow>();

  if (clientError) {
    await reportError(clientError, { operation: "clients.detail_page", organisationId: id });
  }
  if (!client) notFound();
  const website = await checkWebsiteReachabilityCached(client.website);
  // Never `href={website.url}`: on the invalid branch that field is the raw
  // stored text, and a browser resolves a scheme-less string as a path — the
  // "link" to `1-1coco.org` navigated to /clients/1-1coco.org.
  const websiteLink = websiteHref(website);
  const email = validateClientEmail(client.contact_email);

  // F085/F086: every saved version, most recent first, so BookletPanel can render
  // the current one immediately (no fresh, billed Gemini call on page open) and
  // list the rest as a timeline a CAM can browse (F086 AC2: a regeneration must
  // never make a prior version unrecoverable).
  const { data: bookletVersions, error: bookletVersionsError } = await supabase
    .from("client_booklets")
    .select("id, booklet_text, website_url, website_context_used, generated_at")
    .eq("organisation_id", id)
    .order("generated_at", { ascending: false })
    .limit(BOOKLET_HISTORY_LIMIT)
    .returns<SavedBookletRow[]>();

  if (bookletVersionsError) {
    await reportError(bookletVersionsError, {
      operation: "clients.detail_saved_booklet",
      organisationId: id,
    });
  }
  const savedBooklet = bookletVersions?.[0] ?? null;

  // F095 — the persisted priority score and the per-factor inputs behind it.
  // One row per client (unique on organisation_id); read follows the page's
  // independent-query convention: a failed read is logged and the card renders
  // its error state, never taking the profile down. LATEST_SCORES grants
  // SELECT to every active user, so no role gating here — same as Ownership.
  const { data: latestScore, error: latestScoreError } = await supabase
    .from("latest_scores")
    .select("priority_score, priority_band, score_factors")
    .eq("organisation_id", id)
    .maybeSingle<LatestScoreDetailRow>();
  if (latestScoreError) {
    await reportError(latestScoreError, {
      operation: "clients.detail_score_breakdown",
      organisationId: id,
    });
  }

  // ENRICHMENT_RESULTS is append-only (20260804180000_create_org_children.sql), so
  // the most recently enriched row is "the" mission statement, not the only one.
  const { data: enrichment, error: enrichmentError } = await supabase
    .from("enrichment_results")
    .select("mission_statement, enriched_at")
    .eq("organisation_id", id)
    .order("enriched_at", { ascending: false })
    .limit(1)
    .maybeSingle<EnrichmentRow>();

  if (enrichmentError) {
    await reportError(enrichmentError, {
      operation: "clients.detail_enrichment",
      organisationId: id,
    });
  }

  // F191/F192/F193: this client's currently assigned tags, and the full
  // list of tags for the assign dropdown.
  const { data: clientTagRows, error: clientTagsError } = await supabase
    .from("org_tags")
    .select("tag_id, tags(name, colour)")
    .eq("organisation_id", id);
  if (clientTagsError) {
    await reportError(clientTagsError, {
      operation: "clients.detail_tags",
      organisationId: id,
    });
  }
  const clientTags = (clientTagRows ?? [])
    .filter((row) => row.tags)
    .map((row) => ({
      id: row.tag_id,
      name: (row.tags as unknown as { name: string }).name,
      colour:
        (row.tags as unknown as { colour: string | null }).colour ?? null,
    }));

  const { data: allTagsData, error: allTagsError } = await supabase
    .from("tags")
    .select("id, name, colour")
    .order("name");
  if (allTagsError) {
    await reportError(allTagsError, { operation: "clients.detail_all_tags" });
  }
  const allTags = allTagsData ?? [];

  // The generated Supabase types do not know about this branch's new RPC until the
  // remote schema is regenerated, so narrow its table-shaped result at this boundary.
  const { data: rawSourceRows, error: sourcesError } = await supabase
    .rpc("get_organisation_sources_with_actor", { p_organisation_id: id });

  if (sourcesError) {
    await reportError(sourcesError, {
      operation: "clients.detail_sources",
      organisationId: id,
    });
  }
  const sources = formatOrganisationSources(
    (rawSourceRows ?? []) as OrganisationSourceRow[],
  );

  // F080: RLS (attachments_select_active) shares read across every active
  // role, same reasoning as the sources query above. No write path exists yet
  // (F081) — see 20260823090000_create_attachments.sql's header — so this is
  // empty for every client today; that is AC3's correct state, not a bug.
  const { data: attachmentRows, error: attachmentsError } = await supabase
    .from("attachments")
    .select(
      "id, filename, content_type, size_bytes, created_at, timeline_context_type, timeline_context_id, uploaded_by_user:users!attachments_uploaded_by_fkey(full_name)",
    )
    .eq("organisation_id", id)
    .order("created_at", { ascending: false });

  if (attachmentsError) {
    await reportError(attachmentsError, {
      operation: "clients.detail_attachments",
      organisationId: id,
    });
  }
  const attachments = formatAttachments(
    (attachmentRows ?? []) as unknown as AttachmentRow[],
  );

  // Most recent suppression row for this org, whatever its status — pending shows a
  // waiting state, active shows the suppressed state, rejected/lifted/none all fall
  // through to the suppress button.
  const { data: latest } = await supabase
    .from("suppressions")
    .select("status, reason, created_at")
    .eq("organisation_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<LatestSuppression>();

  // Read separately from `client`: owner_id/name isn't part of F068's realtime-driven
  // OrganisationDetailRow, and a deactivated owner's row is invisible under
  // users_select_active (matrix §1) — the fallback below covers that, not an error.
  const { data: ownerRow, error: ownerError } = await supabase
    .from("organisations")
    .select("owner_id, owner:users!organisations_owner_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle<OwnerRow>();

  if (ownerError) {
    await reportError(ownerError, { operation: "clients.detail_owner", organisationId: id });
  }

  // F071/F072/F073/F074: every note against this client, whoever wrote it
  // (F071 AC1). RLS (notes_select_active) shares read across every active
  // role, so this needs no author filter.
  const { data: noteRows, error: notesError } = await supabase
    .from("notes")
    .select("id, content, created_at, updated_at, author_id, author:users!notes_author_id_fkey(full_name)")
    .eq("organisation_id", id);

  if (notesError) {
    await reportError(notesError, { operation: "clients.detail_notes", organisationId: id });
  }

  const canEdit = hasPermission(authorization.actor.role, "client:edit");
  const canSuppress = canEdit;
  const ownerId = ownerRow?.owner_id ?? null;
  const ownerName = ownerRow?.owner?.full_name ?? (ownerId ? "A former team member" : null);
  const isAdmin = authorization.actor.role === "admin";

  // F228: the admin sees their own position against the F227 send limit, so
  // the warning arrives before sends start failing rather than after. Counted
  // per-sender — the exact scope the enforcement (outreach-actions.ts and the
  // scheduled worker) counts — from the same audited sent_at window.
  let sendingVolume: { count: number; limit: number; warning: boolean; windowMinutes: number } | null = null;
  if (isAdmin) {
    const limit = resolveEmailSendLimit();
    const since = emailSendWindowStart(limit.windowSeconds);
    const { count, error: volumeError } = await supabase
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("sent_by_user_id", authorization.actor.id)
      .eq("send_status", "sent")
      .gte("sent_at", since);
    if (volumeError) await reportError(volumeError, { operation: "clients.detail_sending_volume" });
    if (count !== null) {
      sendingVolume = {
        count,
        limit: limit.maximum,
        warning: isNearSendLimit(count, limit.maximum),
        windowMinutes: Math.ceil(limit.windowSeconds / 60),
      };
    }
  }

  // F165: warn the CAM up front when the client they are viewing is owned by
  // someone else, so the compose flow explains a block the route would enforce.
  const ownershipConflict = checkOwnershipConflict({
    ownerId,
    ownerName,
    actorId: authorization.actor.id,
    actorRole: authorization.actor.role,
  });

  // F163: admin's CAM picker. Only fetched for an admin — a CAM can't reach the
  // assign form, so the query would be wasted on every other page view.
  let team: { id: string; full_name: string | null }[] = [];
  if (isAdmin) {
    const { data: teamData, error: teamError } = await supabase
      .from("users")
      .select("id, full_name")
      .eq("role", "cam")
      .order("full_name");
    if (teamError) {
      await reportError(teamError, { operation: "clients.detail_team", organisationId: id });
    }
    team = teamData ?? [];
  }

  const statusLabel = formatOutreachStatus(client.outreach_status);
  const suppressed = latest?.status === "active";
  const suppressionPending = latest?.status === "pending";

  // F126: emails queued for future delivery. Ascending — the next one due is
  // the one a CAM most needs to see.
  const { data: scheduledEmails, error: scheduledEmailsError } = await supabase
    .from("outreach_messages")
    .select("id, subject, scheduled_at")
    .eq("organisation_id", id)
    .eq("send_status", "scheduled")
    .order("scheduled_at", { ascending: true })
    .returns<ScheduledEmailRow[]>();
  if (scheduledEmailsError) {
    await reportError(scheduledEmailsError, { operation: "clients.detail_scheduled_emails", organisationId: id });
  }

  // F129: sends that did not leave, newest first, with the reason from the
  // newest SEND_EVENTS 'failed' record per message (two queries — send_events
  // has no "latest per group" join; the pick happens client-side).
  const { data: failedEmailRows, error: failedEmailsError } = await supabase
    .from("outreach_messages")
    .select("id, subject, updated_at")
    .eq("organisation_id", id)
    .eq("send_status", "failed")
    .order("updated_at", { ascending: false })
    .returns<FailedEmailRow[]>();
  if (failedEmailsError) {
    await reportError(failedEmailsError, { operation: "clients.detail_failed_emails", organisationId: id });
  }
  const failedEmailIds = (failedEmailRows ?? []).map((row) => row.id);
  const failureReasons = new Map<string, string>();
  if (failedEmailIds.length > 0) {
    const { data: failedEventRows, error: failedEventsError } = await supabase
      .from("send_events")
      .select("outreach_message_id, metadata, occurred_at")
      .in("outreach_message_id", failedEmailIds)
      .eq("event_type", "failed")
      .order("occurred_at", { ascending: false });
    if (failedEventsError) {
      await reportError(failedEventsError, { operation: "clients.detail_failed_email_events", organisationId: id });
    }
    for (const event of failedEventRows ?? []) {
      const existing = failureReasons.get(event.outreach_message_id);
      if (existing) continue;
      const reason =
        event.metadata && typeof event.metadata === "object" && typeof event.metadata.reason === "string"
          ? event.metadata.reason
          : "The email could not be sent.";
      failureReasons.set(event.outreach_message_id, reason);
    }
  }
  const failedEmails = (failedEmailRows ?? []).map((row) => ({
    id: row.id,
    subject: row.subject,
    reason: failureReasons.get(row.id) ?? "The email could not be sent.",
  }));

  // #79/#80/#81 (F077/F078/F079): this client's edit suggestions, fetched without a
  // status filter and filtered in the component — RLS already scopes what each role
  // may see (pending rows to every active CAM; authors also their own settled rows;
  // admins everything), so the query can just ask for the org's rows. CAMs get their
  // proposal form plus outcome notices; admins get inline decision cards. Viewers
  // have no write access at all, so the section is not rendered for them.
  let suggestions: EditSuggestionRow[] = [];
  if (authorization.actor.role !== "viewer") {
    const { data: suggestionRows, error: suggestionError } = await supabase
      .from("edit_suggestions")
      .select(EDIT_SUGGESTION_SELECT)
      .eq("organisation_id", id)
      .order("created_at", { ascending: false });
    if (suggestionError) {
      await reportError(suggestionError, {
        operation: "clients.detail_edit_suggestions",
        organisationId: id,
      });
    }
    suggestions = (suggestionRows ?? []) as unknown as EditSuggestionRow[];
  }

  // #23 (F020): the restricted fields are configuration now, not a compile-time
  // list — the proposal form offers exactly what RESTRICTED_EDIT_FIELDS says is
  // active (RLS scopes the read to CAMs and admins). The current values come off the
  // client row already fetched above, so "current vs proposed" reads in one glance.
  let restrictedFields: { field_name: string; label: string }[] = [];
  if (authorization.actor.role === "cam") {
    const { data: fieldRows, error: fieldError } = await supabase
      .from("restricted_edit_fields")
      .select("field_name")
      .eq("active", true)
      .order("field_name");
    if (fieldError) {
      await reportError(fieldError, {
        operation: "clients.detail_restricted_fields",
        organisationId: id,
      });
    }
    restrictedFields = (fieldRows ?? []).map((row) => ({
      field_name: row.field_name,
      label: restrictedFieldLabel(row.field_name),
    }));
  }

  const sensitiveCurrentValues = Object.fromEntries(
    restrictedFields.map((field) => [
      field.field_name,
      client[field.field_name as keyof typeof client] as string | null,
    ]),
  ) as Record<string, string | null>;

  const noteList = buildNoteList((noteRows ?? []) as unknown as NoteRow[], {
    id: authorization.actor.id,
    role: authorization.actor.role,
  });

  // F070: every outreach message for this client, sent or not. RLS
  // (outreach_messages_select_active) shares read across every active role, so
  // this needs no ownership filter — same reasoning as the `client:view` gate
  // above. The sender join backs F125's "record who sent it" attribution in the
  // Sent list (the timeline resolves the same column for its actor name).
  const { data: outreachRows, error: outreachError } = await supabase
    .from("outreach_messages")
    .select("id, subject, body, send_status, sent_at, scheduled_at, created_at, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)")
    .eq("organisation_id", id)
    .order("created_at", { ascending: false });

  if (outreachError) {
    await reportError(outreachError, {
      operation: "clients.detail_outreach",
      organisationId: id,
    });
  }
  const outreachHistory = splitOutreachHistory(
    // `as unknown` — supabase-js infers the users join as an array; timeline
    // rows below need the same escape hatch.
    (outreachRows ?? []) as unknown as OutreachMessageRow[],
  );

  // F119: the most recent still-unsent draft, so ComposeButton can reopen it
  // exactly as it was saved instead of always starting blank. A separate
  // query (not reused from outreachRows above) because it needs contact_id,
  // which the history list has no use for.
  //
  // Gated on not_contacted deliberately: stage-two drafts can only ever be
  // created while the client sits at initial_outreach_sent (isStageTwoEligible),
  // so outside not_contacted the newest draft row may be a follow-up — and
  // reopening that in the Stage 1 card would let "Save draft" overwrite a
  // follow-up's content with Stage 1 state. At not_contacted every draft row is
  // guaranteed stage-one, so hydration is safe exactly there. A stage-one draft
  // abandoned after the pipeline advanced is still visible in the history; it
  // just isn't reopened into this card.
  const existingDraftResult =
    client.outreach_status === "not_contacted"
      ? await supabase
          .from("outreach_messages")
          .select("id, subject, body, sent_to_email, contact_id")
          .eq("organisation_id", id)
          .eq("send_status", "draft")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<{ id: string; subject: string; body: string; sent_to_email: string | null; contact_id: string | null }>()
      : { data: null, error: null };
  const existingDraftRow = existingDraftResult.data;
  if (existingDraftResult.error) {
    await reportError(existingDraftResult.error, { operation: "clients.detail_existing_draft", organisationId: id });
  }
  let existingDraft: {
    id: string;
    subject: string;
    body: string;
    savedRecipient: string | null;
    recipientOnFile: string | null;
  } | null = null;
  if (existingDraftRow) {
    let contactEmail: string | null = null;
    if (existingDraftRow.contact_id) {
      const { data: draftContact } = await supabase
        .from("contacts")
        .select("email")
        .eq("id", existingDraftRow.contact_id)
        .maybeSingle<{ email: string | null }>();
      contactEmail = draftContact?.email ?? null;
    }
    existingDraft = {
      id: existingDraftRow.id,
      subject: existingDraftRow.subject,
      body: existingDraftRow.body,
      // F119 AC1/AC2: the recipient reopens exactly as saved — a reviewed
      // override must survive the round-trip, not be recomputed from
      // contacts.email. The on-file address stays separate purely as the
      // mismatch-warning baseline (F116 AC3).
      savedRecipient: existingDraftRow.sent_to_email?.trim() || null,
      recipientOnFile: contactEmail?.trim() || client.contact_email?.trim() || null,
    };
  }

  // F075/F076: the four sources @/lib/timeline.ts's buildTimeline merges into
  // one feed. Independent queries, not one join — the four tables share no
  // join key that would make sense together (notes/outreach_messages/
  // reply_events key off organisation_id; audit_log keys off
  // target_table+target_id), and each fails independently the same way every
  // other section on this page does (reported, not fatal).
  const { data: timelineNoteRows, error: timelineNotesError } = await supabase
    .from("notes")
    .select("id, content, created_at, updated_at, author:users!notes_author_id_fkey(full_name)")
    .eq("organisation_id", id);
  if (timelineNotesError) {
    await reportError(timelineNotesError, { operation: "clients.timeline_notes", organisationId: id });
  }

  const { data: timelineMessageRows, error: timelineMessagesError } = await supabase
    .from("outreach_messages")
    .select("id, subject, send_status, sent_at, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)")
    .eq("organisation_id", id);
  if (timelineMessagesError) {
    await reportError(timelineMessagesError, {
      operation: "clients.timeline_messages",
      organisationId: id,
    });
  }

  const { data: replyRows, error: replyError, count: replyCount } = await supabase
    .from("reply_events")
    .select("id, outreach_message_id, reply_body, received_at, response_time_seconds", { count: "exact" })
    .eq("organisation_id", id);
  if (replyError) {
    await reportError(replyError, { operation: "clients.timeline_replies", organisationId: id });
  }
  const clientAverageResponseTime = averageResponseTime(replyRows ?? []);

  // F134: only delivered messages belong in the client-visible conversation;
  // drafts, scheduled messages and failures remain in the separate F070 list.
  // reply_events is RLS-protected by the same active-user rule as outreach, so
  // this introduces no wider access path and makes no external API request.
  const emailThread = buildEmailThread(
    outreachHistory.sent,
    (replyRows ?? []) as ThreadReplyRow[],
  );

  // RLS (audit_log_select_client_timeline, 20260820110000) is what makes this
  // readable by a CAM/viewer at all — without it every row here is invisible,
  // not merely filtered, to anyone but an admin.
  const { data: auditRows, error: auditError } = await supabase
    .from("audit_log")
    .select("id, actor_user_id, action, detail, created_at")
    .eq("target_table", "organisations")
    .eq("target_id", id)
    .in("action", ["status_changed", "ownership_reassigned", "edit_suggestion_approved", "edit_suggestion_rejected"]);
  if (auditError) {
    await reportError(auditError, { operation: "clients.timeline_audit", organisationId: id });
  }

  // Degraded, not fatal: the four sources fail independently (each error is
  // reported above), so whatever loaded still renders. `timelineDegraded`
  // only downgrades the section to a warning above the surviving entries —
  // a notes-query failure should not hide the emails and replies that did
  // load. A total failure leaves entries empty and TimelineSection shows its
  // full error state instead.
  const timelineDegraded = Boolean(
    timelineNotesError || timelineMessagesError || replyError || auditError,
  );

  // See collectReferencedUserIds (src/lib/timeline.ts) for why this can't
  // treat every detail.from/detail.to as a user id.
  const referencedUserIds = collectReferencedUserIds((auditRows ?? []) as AuditRow[]);

  const timelineNames = new Map<string, string | null>();
  if (referencedUserIds.size > 0) {
    const { data: referencedUsers, error: namesError } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", Array.from(referencedUserIds));
    if (namesError) {
      await reportError(namesError, { operation: "clients.timeline_names", organisationId: id });
    }
    for (const row of referencedUsers ?? []) {
      timelineNames.set(row.id, row.full_name);
    }
  }

  const timeline = buildTimeline(
    {
      notes: (timelineNoteRows ?? []) as unknown as TimelineNoteRow[],
      outreachMessages: (timelineMessageRows ?? []) as unknown as TimelineOutreachRow[],
      replyEvents: (replyRows ?? []) as unknown as ReplyEventRow[],
      auditRows: (auditRows ?? []) as unknown as AuditRow[],
      attachments: (attachmentRows ?? []) as unknown as AttachmentRow[],
    },
    timelineNames,
  );
  const timelineLinkOptions = buildTimelineLinkOptions(timeline);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-5xl space-y-6">
        <Rise>
          <Link
            className="group inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40 transition-colors hover:text-foreground/70"
            href="/clients"
          >
            <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            Clients
          </Link>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div className="min-w-0">
              <h1 className="text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold font-body leading-[1.05] tracking-[-0.03em]">
                {client.legal_name}
              </h1>
              {/* The record's identity in one line of markers rather than four
                  rows of a table: what it is, where it is, and the two states
                  that change what anyone is allowed to do with it. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Pill>{client.organisation_type}</Pill>
                <Pill>{formatLocation(client)}</Pill>
                <Pill tone={suppressed ? "neutral" : "brand"}>{statusLabel}</Pill>
                {suppressed && <Pill tone="danger">Do not contact</Pill>}
                {suppressionPending && <Pill tone="warn">DNC requested</Pill>}
              </div>
            </div>

            {ownerId && (
              <p className="text-sm leading-[1.7] text-foreground/50">
                Owned by{" "}
                <span className="font-bold text-foreground/75">{ownerName}</span>
                {ownerId === authorization.actor.id ? " (you)" : ""}
              </p>
            )}
          </div>
        </Rise>

        {/* The suppression state leads the record instead of closing it: it
            governs whether outreach is allowed at all, so it has to be read
            before the sections that offer to do outreach — including
            ComposeButton, whose blocked state points back up at this. */}
        {suppressed && (
          <Rise>
            <div
              role="alert"
              className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-destructive">
                Do not contact
              </p>
              <p className="mt-2 text-sm leading-[1.7] text-destructive/90">{latest.reason}</p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-destructive/60">
                Hidden from the active working list. Outreach is blocked. Only an admin
                can lift this.
              </p>
            </div>
          </Rise>
        )}

        {suppressionPending && (
          <Rise>
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-5 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800">
                Do not contact requested
              </p>
              <p className="mt-2 text-sm leading-[1.7] text-amber-900/85">{latest.reason}</p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-amber-800/60">
                Awaiting admin review.
              </p>
            </div>
          </Rise>
        )}

        {/* Two columns from `lg`: the record itself on the left, the things you
            do to it on the right. F067 AC2 asks for every section to be
            reachable without excessive scrolling, and one narrow column of
            eight stacked cards stopped being that once ownership, status and
            sources landed. Below `lg` it folds back to one column in the same
            order. */}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <Group className="space-y-4">
            <Rise>
              <BasicInfoPanel
                organisation={client}
                missionStatement={enrichment?.mission_statement ?? null}
                missionEnrichedAt={enrichment?.enriched_at ?? null}
              />
            </Rise>

            {/* F095 — why this client ranks where it does. Directly under the
                basic info so the "who is this" and "why is it ranked so" read
                as one pass; before the booklet/compose actions, which a CAM
                only acts on once they trust the ranking. */}
            <Rise>
              <ScoreBreakdownCard
                score={latestScore?.priority_score ?? null}
                band={latestScore?.priority_band ?? null}
                factors={latestScore?.score_factors ?? null}
                error={Boolean(latestScoreError)}
              />
            </Rise>

            {/* #79/#80/#81 (F077/F078/F079): sits directly under the values it
                governs, so "current vs proposed" reads in one glance. CAMs propose;
                admins decide inline. Viewers are absent because they have no write
                access at all. */}
            {authorization.actor.role !== "viewer" && (
              <Rise>
                <SuggestEditSection
                  organisationId={client.id}
                  actorId={authorization.actor.id}
                  actorRole={authorization.actor.role}
                  restrictedFields={restrictedFields}
                  currentValues={sensitiveCurrentValues}
                  suggestions={suggestions}
                />
              </Rise>
            )}

            {/* F082 — Generate Client Booklet: kept as its own distinct
                brand-tinted card rather than wrapped in SectionCard — it's the
                flagship AI feature, not another plain record field, and right
                after BasicInfoPanel since a CAM reads this before anything
                else on the page. */}
            {hasPermission(authorization.actor.role, "client:contact") && (
              <Rise>
                <BookletPanel
                  organisationId={client.id}
                  initialWebsiteUrl={
                    savedBooklet?.website_url ?? (website.status === "reachable" ? website.url : null)
                  }
                  savedBooklet={
                    savedBooklet && {
                      id: savedBooklet.id,
                      text: savedBooklet.booklet_text,
                      websiteUrl: savedBooklet.website_url,
                      websiteContextUsed: savedBooklet.website_context_used,
                      generatedAt: savedBooklet.generated_at,
                      // F087: reconstructed from the stored used/not-used boolean
                      // and URL — see sources.ts for why this can't drift from
                      // what a fresh generation's own route response reports.
                      sources: deriveSourcesFromSavedRow({
                        websiteContextUsed: savedBooklet.website_context_used,
                        websiteUrl: savedBooklet.website_url,
                      }),
                    }
                  }
                  priorVersions={(bookletVersions ?? []).slice(1).map((version) => ({
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
            )}

            {/* Styled to match BookletPanel directly above it — both are
                one-shot Gemini-backed actions, so they read as a pair rather
                than one flagship feature and one plain bordered card. */}
            {hasPermission(authorization.actor.role, "client:contact") && (
              <Rise>
                <ComposeButton
                  blocked={suppressed}
                  ownershipBlocked={!suppressed && ownershipConflict.hasConflict}
                  historyHref={
                    hasPermission(authorization.actor.role, "platform-settings:manage")
                      ? `/admin/ai-generations?client=${client.id}`
                      : undefined
                  }
                  organisationId={client.id}
                  suppressionReason={suppressed ? latest?.reason : undefined}
                  ownershipWarning={
                    ownershipConflict.hasConflict ? ownershipConflict.warning : undefined
                  }
                  hasSavedBooklet={savedBooklet !== null}
                  existingDraft={existingDraft}
                />
                {/* F126: what is queued for later, with cancel — shown in the same
                    card as the compose flow that created the schedule. */}
                <ScheduledEmailList organisationId={client.id} messages={scheduledEmails ?? []} />
                {/* F129: what did not leave, with retry — same card, same story. */}
                <FailedEmailList organisationId={client.id} messages={failedEmails} />
              </Rise>
            )}

            {/* Email and website were two near-identical cards — same
                heading-plus-validity-pill shape, same failure copy — so they
                read as one "can we actually reach them?" card instead. */}
            <Rise>
              <SectionCard headingId="contactability-heading" title="Contactability">
                <dl className="mt-4 divide-y divide-black/[0.05]">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 pb-3.5">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                      Email
                    </dt>
                    <Pill tone={email.status === "valid" ? "brand" : "danger"}>
                      {email.status === "valid"
                        ? "Valid format"
                        : email.status === "invalid"
                          ? "Invalid format"
                          : "Missing"}
                    </Pill>
                    <dd
                      className={`w-full break-all text-sm leading-[1.6] ${
                        email.status === "invalid"
                          ? "font-bold text-destructive"
                          : email.value
                            ? "text-foreground/80"
                            : "text-foreground/35"
                      }`}
                    >
                      {email.value ?? "Not provided"}
                    </dd>
                    {email.message && (
                      <p className="w-full text-[13px] leading-[1.6] text-destructive/80" role="alert">
                        {email.message} The rest of this client record is still available.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 pt-3.5">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                      Website
                    </dt>
                    <Pill tone={website.status === "reachable" ? "brand" : "danger"}>
                      {website.status === "reachable"
                        ? "Reachable"
                        : website.status === "invalid"
                          ? "Invalid URL"
                          : website.status === "missing"
                            ? "Missing"
                            : "Unreachable"}
                    </Pill>
                    <dd className="w-full text-sm leading-[1.6]">
                      {websiteLink ? (
                        <a
                          aria-label={`Tap to open website ${websiteLink} in new tab`}
                          className={`group inline-flex items-center gap-1.5 break-all underline decoration-1 underline-offset-2 transition-colors ${
                            website.status === "reachable"
                              ? "text-brand-hover hover:text-brand"
                              : "font-bold text-destructive"
                          }`}
                          href={websiteLink}
                          rel="noreferrer"
                          target="_blank"
                          title="Tap to open website in new tab"
                        >
                          <span className="break-all">{websiteLink}</span>
                          <ExternalLink
                            aria-hidden="true"
                            className="h-3.5 w-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                          />
                        </a>
                      ) : website.url ? (
                        // Malformed: show what is stored, as text. There is
                        // nowhere safe to send anyone.
                        <span className="break-all font-bold text-destructive">{website.url}</span>
                      ) : (
                        <span className="text-foreground/35">Not provided</span>
                      )}
                    </dd>
                    {websiteLink && (
                      <p className="w-full text-[11px] font-medium tracking-wide text-foreground/40">
                        Tap to open in new tab
                      </p>
                    )}
                    {website.message && (
                      <p className="w-full text-[13px] leading-[1.6] text-destructive/80" role="alert">
                        {website.message} Booklet generation may use unreliable or missing
                        website context.
                      </p>
                    )}
                  </div>
                </dl>
              </SectionCard>
            </Rise>

            <Rise>
              <SectionCard
                headingId="source-heading"
                title="Record sources"
                hint="Where the information in this client record came from."
              >
                {sourcesError ? (
                  <p className="mt-4 text-sm font-bold text-destructive" role="alert">
                    Source information could not be loaded. Refresh and try again.
                  </p>
                ) : sources.length === 0 ? (
                  <p className="mt-4 text-sm leading-[1.7] text-foreground/45">
                    No source information recorded.
                  </p>
                ) : (
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {sources.map((source) => (
                      <li
                        key={source.source}
                        className="rounded-full bg-brand/10 px-3 py-1.5 text-[13px] font-bold text-brand-hover"
                        title={`First recorded ${new Date(source.first_seen_at).toLocaleDateString("en-GB")}`}
                      >
                        {source.label}
                        {source.source_actor_name ? ` · ${source.source_actor_name}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </Rise>

            <Rise>
              <SectionCard
                headingId="attachments-heading"
                title="Attachments"
                hint="Files attached to this client."
              >
                <AttachmentsSection
                  organisationId={client.id}
                  attachments={attachments}
                  error={Boolean(attachmentsError)}
                  canLink={canEdit}
                  timelineOptions={timelineLinkOptions}
                />
                {/* F081: upload sits inside the same card so the new file
                    appears in the list directly above it on refresh (AC4). */}
                {canEdit && <UploadAttachmentForm organisationId={client.id} />}
              </SectionCard>
            </Rise>

            <Rise>
              <SectionCard
                headingId="notes-heading"
                title="Notes"
                hint="Left by any team member — relationship history everyone can see."
              >
                <NotesSection
                  notes={noteList}
                  error={Boolean(notesError)}
                  organisationId={client.id}
                />
                {canEdit && <AddNoteForm organisationId={client.id} />}
              </SectionCard>
            </Rise>
          </Group>

          <Group className="space-y-4">
            <Rise>
              <SectionCard headingId="ownership-heading" title="Ownership">
                {ownerId ? (
                  <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
                    Owned by <span className="font-bold text-foreground/85">{ownerName}</span>
                    {ownerId === authorization.actor.id ? " (you)" : ""}.
                  </p>
                ) : canEdit ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-sm leading-[1.7] text-foreground/55">
                      Unassigned. Claim it to take responsibility for outreach on this
                      client.
                    </p>
                    <ClaimButton organisationId={client.id} />
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-[1.7] text-foreground/45">Unassigned.</p>
                )}

                {isAdmin && (
                  <AssignOwnerForm
                    organisationId={client.id}
                    currentOwnerId={ownerId}
                    currentOwnerName={ownerName}
                    team={team}
                  />
                )}
              </SectionCard>
            </Rise>
            <Rise>
              <SectionCard headingId="tags-heading" title="Tags">
                <TagsSection
                  organisationId={client.id}
                  initialClientTags={clientTags}
                  availableTags={allTags}
                  canEdit={canEdit}
                />
              </SectionCard>
            </Rise>
            {(isAdmin || ownerId === authorization.actor.id) && (
              <Rise>
                <SectionCard
                  headingId="status-heading"
                  title="Pipeline status"
                  hint="Where this client sits in the outreach pipeline. Shown on the client list too."
                >
                  <StatusSelect
                    key={`profile-${client.outreach_status}`}
                    organisationId={client.id}
                    currentStatus={client.outreach_status}
                  />
                </SectionCard>
              </Rise>
            )}

            {/* F070: the history itself is readable by every active role
                (outreach_messages_select_active), so the card is not gated on
                client:contact — only ComposeButton inside it is.
                F019 (#22): a non-owning CAM sees that button dead, with the
                owner-naming warning rendered up front, rather than discovering
                the block on click — the preflight behind it remains the
                enforcement either way. */}
            <Rise>
              <SectionCard headingId="outreach-heading" title="Outreach">
                {replyError ? (
                  <p className="mt-3 text-sm font-medium text-red-800" role="alert">
                    Reply count could not be loaded. Refresh and try again.
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-foreground/65">
                    <span className="font-bold text-foreground">
                      {(replyCount ?? 0).toLocaleString()}
                    </span>{" "}
                    {replyCount === 1 ? "reply" : "replies"} received
                    {clientAverageResponseTime !== null
                      ? ` · Average response ${formatResponseTime(clientAverageResponseTime)}`
                      : " · Average response not available yet"}
                  </p>
                )}
                {sendingVolume && (
                  <p className={`mt-3 rounded-lg p-3 text-sm font-bold ${sendingVolume.warning ? "bg-amber-50 text-amber-900" : "bg-black/[0.03] text-foreground/60"}`} role={sendingVolume.warning ? "alert" : "status"}>
                    Your sending volume: {sendingVolume.count} of your {sendingVolume.limit} emails in the current {sendingVolume.windowMinutes}-minute window.{sendingVolume.warning ? " You are close to the configured threshold; sends are refused once it is reached." : ""}
                  </p>
                )}
                <OutreachHistorySection
                  history={outreachHistory}
                  error={Boolean(outreachError)}
                  thread={emailThread}
                  threadError={Boolean(outreachError || replyError)}
                  statusControl={
                    isAdmin || ownerId === authorization.actor.id
                      ? {
                          organisationId: client.id,
                          currentStatus: client.outreach_status,
                        }
                      : undefined
                  }
                  noteOrganisationId={canEdit ? client.id : undefined}
                />

                {hasPermission(authorization.actor.role, "client:contact") && (
                  <div className="mt-4">
                    {/* F101: the follow-up trigger only exists while the client sits at
                        initial_outreach_sent — Stage 1 sent, nothing since. The route
                        re-enforces eligibility (isStageTwoEligible) server-side, so this
                        presentation gate is convenience over an enforcement that does not
                        depend on it; once the pipeline moves on, the action disappears. */}
                    {client.outreach_status === "initial_outreach_sent" && (
                      <div className="mt-4">
                        <FollowUpButton
                          blocked={suppressed}
                          ownershipBlocked={!suppressed && ownershipConflict.hasConflict}
                          organisationId={client.id}
                          suppressionReason={suppressed ? latest?.reason : undefined}
                          ownershipWarning={ownershipConflict.hasConflict ? ownershipConflict.warning : undefined}
                        />
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>
            </Rise>

            {/* Only the action lives down here — the resulting state is the
                banner at the top of the page, so there is nothing to show once
                a suppression exists. */}
            {!suppressed && !suppressionPending && canSuppress && (
              <Rise>
                <SectionCard
                  headingId="suppress-heading"
                  title="Do not contact"
                  tone="danger"
                  hint="Flagging this client hides it from the active working list and blocks outreach."
                >
                  <div className="mt-4">
                    <SuppressButton
                      organisationId={client.id}
                      selfApproves={isAdmin}
                    />
                  </div>
                </SectionCard>
              </Rise>
            )}
          </Group>
        </div>

        {/* F075/F076: Full-width, not squeezed into either column: this is the one
            section that reads across every other one on this page — emails,
            replies, notes, status, ownership — so it earns its own row rather
            than fighting a narrow column for space. */}
        <Rise>
          <SectionCard
            headingId="timeline-heading"
            title="Timeline"
            hint="Every email, reply, note and change for this client, in one place."
          >
            <TimelineSection
              entries={timeline}
              degraded={timelineDegraded}
              organisationId={client.id}
            />
          </SectionCard>
        </Rise>
        <TimelineRealtimeRefresher organisationId={client.id} />
      </Stage>
    </div>
  );
}
