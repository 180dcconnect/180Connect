/**
 * F075/F076 reuse — the Outreach Inbox (/inbox): a Gmail-style list of the
 * CAM's outreach threads, one row per organisation, newest activity first.
 *
 * Read-only by design (PRD §12.1): a thread row links to the client page,
 * where the existing outreach flow lives. Sending happens in the CAM's own
 * Gmail via the approved send path, never from this list.
 *
 * Every role with client:view sees it: RLS already grants SELECT on
 * outreach_messages/reply_events to every active user (matrix §3.4), and
 * open-questions.md records that viewers read communication history in full.
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
import { ThreadList } from "@/components/inbox/thread-list";

/**
 * Fetch cap — all sent messages ever (agreed v1 scope), paged the same way
 * the dashboard's fetchAllRows does. Replies are bounded by the message cap
 * (a reply without its message is still shown, but the practical volume
 * tracks the sent-message count).
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

  // Fail-soft per source: a failed reply query shouldn't hide the threads
  // that did load (same convention as the dashboard's F028 sources).
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

  const threads: InboxThread[] = buildInboxThreads(messages, replies, orgNames);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-bold mb-1">Outreach Inbox</h1>
      <p className="text-sm text-muted-foreground mb-6">
        All outreach threads, newest activity first. Click a thread to open the client page.
      </p>
      <ThreadList threads={threads} />
    </div>
  );
}
