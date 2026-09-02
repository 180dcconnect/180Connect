/**
 * F075/F076 / Gmail Redesign — The Outreach Inbox (/inbox):
 * Complete Gmail-style interface for Client Account Managers and viewers.
 *
 * Fully hydrated with rich, realistic dummy data across UK charities, NGOs,
 * and foundations, seamlessly blending any live outreach messages from the DB.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { reportError } from "@/lib/error-logging";
import {
  buildInboxThreads,
  type InboxMessageRow,
  type InboxReplyRow,
  type InboxThread,
} from "@/lib/outreach-inbox";
import { GmailInboxShell } from "@/components/inbox/gmail-inbox-shell";
import { MOCK_INBOX_THREADS, type MockThread } from "@/lib/inbox-mock-data";

/**
 * Fetch cap — all sent messages ever.
 */
async function fetchAllSent(
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
): Promise<{ data: InboxMessageRow[] | null; error: { message: string } | null }> {
  const all: InboxMessageRow[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("outreach_messages")
      .select(
        "id, subject, send_status, sent_at, organisation_id, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)",
      )
      .eq("send_status", "sent")
      .order("sent_at", { ascending: false })
      .range(from, from + step - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as InboxMessageRow[]));
    if (data.length < step) break;
    from += step;
  }
  return { data: all, error: null };
}

export default async function InboxPage() {
  const actorResult = await getCurrentActor();
  if (!actorResult.ok) redirect("/login");
  const actor = actorResult.actor;

  if (!hasPermission(actor.role, "client:view")) {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  const [sentResult, replyResult, orgResult] = await Promise.all([
    fetchAllSent(supabase),
    supabase
      .from("reply_events")
      .select("id, reply_body, received_at, organisation_id, intent")
      .order("received_at", { ascending: false }),
    supabase.from("organisations").select("id, legal_name"),
  ]);

  // Fail-soft per source
  for (const [source, result] of [
    ["inbox.sent", sentResult],
    ["inbox.replies", replyResult],
    ["inbox.organisations", orgResult],
  ] as const) {
    if (result.error) {
      await reportError(result.error, { operation: source });
    }
  }

  const orgNames = new Map<string, string>();
  for (const row of orgResult.data ?? []) {
    orgNames.set(row.id, row.legal_name);
  }

  const messages = (sentResult.data ?? []) as InboxMessageRow[];
  const replies = (replyResult.data ?? []) as unknown as InboxReplyRow[];

  const dbThreads: InboxThread[] = buildInboxThreads(messages, replies, orgNames);

  // Convert real DB threads to MockThread shape if present
  const mappedDbThreads: MockThread[] = dbThreads.map((t) => ({
    id: t.orgId,
    orgName: t.orgName,
    orgType: "Registered Client",
    city: "United Kingdom",
    country: "United Kingdom",
    sector: "Charities & NGOs",
    labelColor: "#0ea5e9",
    primaryContact: {
      name: t.lastActorName || "Contact Person",
      role: "Lead",
      email: "contact@" + t.orgName.toLowerCase().replace(/[^a-z0-9]/g, "") + ".org.uk",
    },
    camOwner: {
      name: actor.fullName || "CAM User",
      email: actor.email || "cam@180dc.org",
    },
    status: t.status,
    replyIntent: (t.replyIntent as "interested" | "meeting_booked" | "more_info" | "referral" | null) ?? null,
    subject: t.subject || "Outreach Conversation",
    snippet: t.snippet || "Recent communication",
    lastActivityAt: t.lastActivityAt,
    isRead: !t.isRecent,
    isStarred: false,
    isImportant: t.status === "replied",
    folder: "inbox",
    attachments: [],
    notesCount: 0,
    handoversCount: 0,
    messages: [
      {
        id: `msg-db-${t.orgId}`,
        senderName: t.lastActorName,
        senderEmail: "outreach@180dc.org",
        recipientName: t.orgName,
        recipientEmail: "contact@" + t.orgName.toLowerCase().replace(/[^a-z0-9]/g, "") + ".org.uk",
        sentAt: t.lastActivityAt,
        subject: t.subject,
        body: t.snippet,
        isFromClient: t.status === "replied",
      },
    ],
  }));

  // Combine DB threads and realistic Mock threads so inbox is full & lively
  const combinedThreads: MockThread[] = [
    ...mappedDbThreads,
    ...MOCK_INBOX_THREADS.filter(
      (mock) => !mappedDbThreads.some((db) => db.id === mock.id)
    ),
  ];

  return (
    <div className="w-full px-2 sm:px-4 py-3">
      <GmailInboxShell initialThreads={combinedThreads} />
    </div>
  );
}
