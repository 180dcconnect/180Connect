/**
 * /inbox/[orgId] — one thread's conversation, beside the client context needed
 * to answer it.
 *
 * What this page IS:
 * - The full past of the conversation: every sent email and every client
 *   reply, interleaved chronologically (oldest first, like reading an email
 *   thread top-down), scoped to this one organisation.
 * - The client context a CAM needs before replying — who they are, who owns
 *   them, how long we have been talking, what has been written down, what has
 *   been attached — in a rail beside the thread rather than a page navigation
 *   away from it.
 * - The place a reply is written. ReplyDrawer generates a Stage 2 follow-up and
 *   sends it through the approved server actions (PRD §12.1 — Gmail API on the
 *   CAM's own authorised account), the same path the client page uses.
 *
 * Eligibility for that reply is NOT widened here: the stage-two endpoint
 * enforces `isStageTwoEligible` (outreach_status === "initial_outreach_sent"),
 * so this page offers the drawer under exactly that condition and falls back to
 * the client-page deep-link otherwise. Offering it more widely would be a
 * button whose only outcome is a 409.
 *
 * Every role with client:view sees the thread and the rail (matrix §3.4); RLS
 * grants SELECT on outreach_messages/reply_events to every active user. Writing
 * — the reply drawer, the note quick-add — is gated on client:contact and
 * client:edit respectively, the same populations the routes behind them check.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { formatAttachments, type AttachmentRow } from "@/lib/attachments";
import { buildRelationshipStats, recentHandovers } from "@/lib/inbox-thread-context";
import { buildDisplayNote, orderNotesNewestFirst, type NoteRow } from "@/lib/note-history";
import { formatLocation, formatOrganisationType } from "@/lib/organisation-format";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";
import { isStageTwoEligible } from "@/lib/outreach/stage-two-generation";
import {
  buildConversation,
  threadStatus,
  type ConversationEntry,
  type InboxMessageRow,
  type InboxReplyRow,
} from "@/lib/outreach-inbox";
import {
  buildOwnershipReassignedEntry,
  type AuditRow,
  type TimelineEntry,
} from "@/lib/timeline";
import { ConversationView } from "@/components/inbox/conversation-view";
import { ReplyDrawer } from "@/components/inbox/reply-drawer";
import { ThreadContextRail } from "@/components/inbox/thread-context-rail";

/** How many notes the rail previews before deferring to the client page. */
const RAIL_NOTE_LIMIT = 3;
/** How many attachments the rail lists before deferring to the client page. */
const RAIL_ATTACHMENT_LIMIT = 4;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type OrganisationRow = {
  id: string;
  legal_name: string;
  organisation_type: string | null;
  city: string | null;
  country_code: string;
  outreach_status: string;
  contact_email: string | null;
  owner_id: string | null;
  owner: { full_name: string | null } | null;
};

/**
 * The conversation itself. Split from the context fetch below so a failure in
 * one cannot take the other down — the same fail-soft convention the client
 * page uses across its sections.
 */
async function fetchThread(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{
  organisation: OrganisationRow | null;
  entries: ConversationEntry[];
  /** contacts.id → display name, so replies can name who wrote them. */
  contactNames: Map<string, string>;
  /** Best recipient on file: the primary contact's email, else the org's. */
  recipientOnFile: string | null;
}> {
  const [sentResult, replyResult, orgResult, contactsResult] = await Promise.all([
    supabase
      .from("outreach_messages")
      .select(
        "id, subject, body, send_status, sent_at, organisation_id, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)",
      )
      .eq("organisation_id", orgId)
      .order("sent_at", { ascending: false })
      .limit(500),
    supabase
      .from("reply_events")
      .select("id, reply_body, received_at, organisation_id, intent, contact_id")
      .eq("organisation_id", orgId)
      .order("received_at", { ascending: false })
      .limit(500),
    supabase
      .from("organisations")
      .select(
        "id, legal_name, organisation_type, city, country_code, outreach_status, contact_email, owner_id, owner:users!organisations_owner_id_fkey(full_name)",
      )
      .eq("id", orgId)
      .maybeSingle(),
    // Primary first, then oldest — the same ordering the stage-one generator
    // uses to decide who "the contact" is, so the recipient this page shows is
    // the recipient a generated draft would carry.
    supabase
      .from("contacts")
      .select("id, first_name, last_name, email")
      .eq("organisation_id", orgId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true }),
  ]);

  for (const [source, result] of [
    ["inbox.thread.sent", sentResult],
    ["inbox.thread.replies", replyResult],
    ["inbox.thread.organisation", orgResult],
    ["inbox.thread.contacts", contactsResult],
  ] as const) {
    if (result.error) {
      await reportError(result.error, { operation: source, organisationId: orgId });
    }
  }

  const organisation = (orgResult.data ?? null) as unknown as OrganisationRow | null;
  if (!organisation) {
    return { organisation: null, entries: [], contactNames: new Map(), recipientOnFile: null };
  }

  const contactRows = (contactsResult.data ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  }[];
  const contactNames = new Map<string, string>();
  for (const row of contactRows) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    if (name) contactNames.set(row.id, name);
  }

  const entries = buildConversation(
    (sentResult.data ?? []) as unknown as (InboxMessageRow & { body?: string | null })[],
    (replyResult.data ?? []) as unknown as InboxReplyRow[],
    orgId,
    new Map([[organisation.id, organisation.legal_name]]),
    contactNames,
  );

  return {
    organisation,
    entries,
    contactNames,
    recipientOnFile:
      contactRows.find((row) => row.email?.trim())?.email?.trim() ||
      organisation.contact_email?.trim() ||
      null,
  };
}

/**
 * The rail's four blocks. Each source fails independently and reports its own
 * error — a notes query that fails should not cost the reader the ownership
 * history that loaded fine.
 */
async function fetchThreadContext(supabase: SupabaseClient, orgId: string) {
  const [notesResult, attachmentsResult, auditResult, suppressionResult] = await Promise.all([
    supabase
      .from("notes")
      .select("id, content, created_at, updated_at, author:users!notes_author_id_fkey(full_name)")
      .eq("organisation_id", orgId),
    supabase
      .from("attachments")
      .select(
        "id, filename, content_type, size_bytes, created_at, uploaded_by_user:users!attachments_uploaded_by_fkey(full_name)",
      )
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: false }),
    // There is no ownership_history table — audit_log is the only record of who
    // held this client before. RLS (audit_log_select_client_timeline) is what
    // makes these rows readable by a CAM or viewer at all.
    supabase
      .from("audit_log")
      .select("id, actor_user_id, action, detail, created_at")
      .eq("target_table", "organisations")
      .eq("target_id", orgId)
      .eq("action", "ownership_reassigned"),
    supabase
      .from("suppressions")
      .select("status, reason")
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ status: string; reason: string | null }>(),
  ]);

  for (const [source, result] of [
    ["inbox.thread.notes", notesResult],
    ["inbox.thread.attachments", attachmentsResult],
    ["inbox.thread.audit", auditResult],
    ["inbox.thread.suppression", suppressionResult],
  ] as const) {
    if (result.error) {
      await reportError(result.error, { operation: source, organisationId: orgId });
    }
  }

  const noteRows = orderNotesNewestFirst((notesResult.data ?? []) as unknown as NoteRow[]);
  const attachments = formatAttachments(
    (attachmentsResult.data ?? []) as unknown as AttachmentRow[],
  );

  // actor_user_id and detail.from/detail.to are bare uuids (detail is jsonb,
  // not a foreign key PostgREST can embed), so they are resolved in one batch
  // rather than per-row. A name missing from this map reads as "A former team
  // member" in @/lib/timeline, never as a raw id or blank.
  const auditRows = (auditResult.data ?? []) as unknown as AuditRow[];
  const referencedUserIds = new Set<string>();
  for (const row of auditRows) {
    if (row.actor_user_id) referencedUserIds.add(row.actor_user_id);
    for (const key of ["from", "to"] as const) {
      const value = row.detail?.[key];
      if (typeof value === "string") referencedUserIds.add(value);
    }
  }
  const names = new Map<string, string | null>();
  if (referencedUserIds.size > 0) {
    const { data: users, error: namesError } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", Array.from(referencedUserIds));
    if (namesError) {
      await reportError(namesError, { operation: "inbox.thread.audit_names", organisationId: orgId });
    }
    for (const row of (users ?? []) as { id: string; full_name: string | null }[]) {
      names.set(row.id, row.full_name);
    }
  }
  const handovers: TimelineEntry[] = recentHandovers(
    auditRows.map((row) => buildOwnershipReassignedEntry(row, names)),
  );

  return {
    notes: noteRows.slice(0, RAIL_NOTE_LIMIT).map(buildDisplayNote),
    noteCount: noteRows.length,
    notesError: Boolean(notesResult.error),
    attachments: attachments.slice(0, RAIL_ATTACHMENT_LIMIT),
    attachmentsError: Boolean(attachmentsResult.error),
    handovers,
    suppression: suppressionResult.data ?? null,
  };
}

export default async function InboxThreadPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const actorResult = await getCurrentActor();
  if (!actorResult.ok) redirect("/login");
  const actor = actorResult.actor;

  if (!hasPermission(actor.role, "client:view")) {
    redirect("/dashboard");
  }

  const { orgId } = await params;
  const supabase = await createClient();
  const [{ organisation, entries, recipientOnFile }, context] = await Promise.all([
    fetchThread(supabase, orgId),
    fetchThreadContext(supabase, orgId),
  ]);

  if (!organisation) {
    redirect("/inbox");
  }

  const ownerName =
    organisation.owner?.full_name ?? (organisation.owner_id ? "A former team member" : null);
  const ownershipConflict = checkOwnershipConflict({
    ownerId: organisation.owner_id,
    ownerName: organisation.owner?.full_name,
    actorId: actor.id,
    actorRole: actor.role,
  });
  const suppressed = context.suppression?.status === "active";

  // threadStatus reads newest-first; `entries` is the reading order (oldest
  // first), so it is reversed here rather than re-derived from the raw rows.
  const status = threadStatus([...entries].reverse());
  const stats = buildRelationshipStats(entries);
  const newestReplyIntent =
    [...entries].reverse().find((entry) => entry.type === "reply_received")?.intent ?? null;

  const canContact = hasPermission(actor.role, "client:contact");
  const canReplyInline = canContact && isStageTwoEligible(organisation.outreach_status);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2 text-sm">
        <Link href="/inbox" className="text-muted-foreground transition-colors hover:text-foreground">
          ← Inbox
        </Link>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold leading-tight">{organisation.legal_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {entries.length === 0
            ? "No conversation history yet."
            : `${entries.length} message${entries.length === 1 ? "" : "s"}, oldest first.`}
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <ConversationView entries={entries} />

          {canReplyInline && (
            <ReplyDrawer
              blocked={suppressed || ownershipConflict.hasConflict}
              blockedReason={
                suppressed
                  ? `This client is suppressed. Outreach is blocked. Reason: ${context.suppression?.reason ?? "No reason was recorded."}`
                  : ownershipConflict.hasConflict
                    ? ownershipConflict.warning
                    : undefined
              }
              organisationId={orgId}
              recipientOnFile={recipientOnFile}
            />
          )}
          {/* Outside the Stage 2 window there is no generation to offer, so the
              link out stands: the client record's Outreach tab owns saved
              drafts, manual composition and everything else outreach. It used
              to be a `#outreach-heading` anchor on one long page; that anchor
              no longer exists — and had in fact resolved to the wrong card,
              because two of them shared the id. */}
          {canContact && !canReplyInline && (
            <a
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
              href={`/clients/${orgId}/outreach`}
            >
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              Continue outreach on the client page
            </a>
          )}
        </div>

        <ThreadContextRail
          attachments={context.attachments}
          attachmentsError={context.attachmentsError}
          canAddNote={hasPermission(actor.role, "client:edit")}
          handovers={context.handovers}
          location={formatLocation(organisation)}
          noteCount={context.noteCount}
          notes={context.notes}
          notesError={context.notesError}
          organisationId={orgId}
          organisationName={organisation.legal_name}
          organisationType={
            organisation.organisation_type
              ? formatOrganisationType(organisation.organisation_type)
              : null
          }
          ownerName={ownerName}
          replyIntent={newestReplyIntent}
          stats={stats}
          status={status}
        />
      </div>
    </div>
  );
}
