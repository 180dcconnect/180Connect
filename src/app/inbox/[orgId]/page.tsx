/**
 * /inbox/[orgId] — one thread's conversation, beside the client context needed
 * to answer it.
 *
 * Fully supports live database threads as well as rich mock threads from the
 * Gmail outreach dataset.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles, ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { onFileEmail } from "@/lib/client-email-validation";
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
import { getMockThreadById, type MockThread } from "@/lib/inbox-mock-data";

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

async function fetchThread(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{
  organisation: OrganisationRow | null;
  entries: ConversationEntry[];
  contactNames: Map<string, string>;
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
    // Check mock fallback
    const mock = getMockThreadById(orgId);
    if (mock) {
      const mockOrg: OrganisationRow = {
        id: mock.id,
        legal_name: mock.orgName,
        organisation_type: mock.orgType,
        city: mock.city,
        country_code: "GB",
        outreach_status: "initial_outreach_sent",
        contact_email: mock.primaryContact.email,
        owner_id: "user-cam-1",
        owner: { full_name: mock.camOwner.name },
      };

      const mockEntries: ConversationEntry[] = mock.messages.map((m) => ({
        id: m.id,
        type: m.isFromClient ? "reply_received" : "email_sent",
        timestamp: m.sentAt,
        actorName: m.senderName,
        subject: m.isFromClient ? null : m.subject,
        body: m.body,
        intent: m.intent ?? null,
      }));

      return {
        organisation: mockOrg,
        entries: mockEntries,
        contactNames: new Map([[mock.id, mock.primaryContact.name]]),
        recipientOnFile: mock.primaryContact.email,
      };
    }

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
    // A redacted contact_email is not an address on file — offering it as the
    // recipient would put `[redacted:personal-email]` in the To field.
    recipientOnFile:
      contactRows.find((row) => row.email?.trim())?.email?.trim() ||
      onFileEmail(organisation.contact_email) ||
      null,
  };
}

async function fetchThreadContext(supabase: SupabaseClient, orgId: string, mock?: MockThread) {
  if (mock) {
    return {
      notes: [
        {
          id: `note-${mock.id}-1`,
          content: `Initial outreach initiated via 180DC outreach sequence for ${mock.orgName}.`,
          authorName: mock.camOwner.name,
          createdAt: mock.lastActivityAt,
          edited: false,
        },
      ],
      noteCount: mock.notesCount,
      notesError: false,
      attachments: mock.attachments.map((att) => ({
        id: att.id,
        filename: att.filename,
        contentType: att.fileType === "pdf" ? "application/pdf" : "application/octet-stream",
        sizeLabel: `${(att.sizeBytes / 1000000).toFixed(1)} MB`,
        uploadedByName: mock.camOwner.name,
        createdAt: mock.lastActivityAt,
      })),
      attachmentsError: false,
      handovers: [],
      suppression: null,
    };
  }

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
  const mock = getMockThreadById(orgId);

  const [{ organisation, entries, recipientOnFile }, context] = await Promise.all([
    fetchThread(supabase, orgId),
    fetchThreadContext(supabase, orgId, mock),
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

  const status = threadStatus([...entries].reverse());
  const stats = buildRelationshipStats(entries);
  const newestReplyIntent =
    [...entries].reverse().find((entry) => entry.type === "reply_received")?.intent ?? null;

  const canContact = hasPermission(actor.role, "client:contact");
  const canReplyInline = canContact && isStageTwoEligible(organisation.outreach_status);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <Link
          href="/inbox"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Inbox</span>
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight text-slate-900">{organisation.legal_name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {entries.length === 0
              ? "No conversation history yet."
              : `${entries.length} message${entries.length === 1 ? "" : "s"}, chronologically ordered.`}
          </p>
        </div>

        <Link
          href={`/clients/${orgId}`}
          className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
        >
          View Full Client File →
        </Link>
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
