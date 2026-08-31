/**
 * /inbox/[orgId] — one thread's conversation: the full past of the CAM's
 * outreach with that client, newest-first list → tap → full history.
 *
 * What this page IS:
 * - The full past of the conversation: every sent email and every client
 *   reply, interleaved chronologically (oldest first, like reading an email
 *   thread top-down) — the same four timeline sources the client page merges,
 *   scoped to this one organisation.
 * - The launch point for a NEW response: the "Generate reply draft" CTA
 *   deep-links into the client page's AI compose flow (stage-two draft), which
 *   owns generation, review, and the approved send path (PRD §12.1). This page
 *   never sends.
 *
 * Every role with client:view sees it (matrix §3.4); RLS grants SELECT on
 * outreach_messages/reply_events to every active user.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import {
  buildConversation,
  type ConversationEntry,
  type InboxMessageRow,
  type InboxReplyRow,
} from "@/lib/outreach-inbox";
import { ConversationView } from "@/components/inbox/conversation-view";

async function fetchThread(
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
  orgId: string,
): Promise<{
  orgName: string | null;
  entries: ConversationEntry[];
  notFound: boolean;
}> {
  const [sentResult, replyResult, orgResult] = await Promise.all([
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
      .select("id, reply_body, received_at, organisation_id, intent")
      .eq("organisation_id", orgId)
      .order("received_at", { ascending: false })
      .limit(500),
    supabase.from("organisations").select("id, legal_name").eq("id", orgId).maybeSingle(),
  ]);

  for (const [source, result] of [
    ["inbox.thread.sent", sentResult],
    ["inbox.thread.replies", replyResult],
    ["inbox.thread.organisation", orgResult],
  ] as const) {
    if (result.error) {
      await reportError(result.error, { operation: source });
    }
  }

  const orgRow = (orgResult.data ?? null) as { id: string; legal_name: string } | null;
  if (!orgRow) return { orgName: null, entries: [], notFound: true };

  const entries = buildConversation(
    (sentResult.data ?? []) as unknown as (InboxMessageRow & { body?: string | null })[],
    (replyResult.data ?? []) as unknown as InboxReplyRow[],
    orgId,
    new Map([[orgRow.id, orgRow.legal_name]]),
  );

  return { orgName: orgRow.legal_name, entries, notFound: false };
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
  const { orgName, entries, notFound } = await fetchThread(supabase, orgId);

  if (notFound) {
    redirect("/inbox");
  }

  // The generate-a-response CTA deep-links into the client page's AI compose
  // flow (stage-two draft): generation, review, and the approved send path all
  // live there (PRD §12.1) — this page never sends.
  const canContact = hasPermission(actor.role, "client:contact");
  const composeHref = `/clients/${orgId}#outreach-heading`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2 text-sm">
        <Link href="/inbox" className="text-muted-foreground transition-colors hover:text-foreground">
          ← Inbox
        </Link>
      </div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-tight">{orgName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {entries.length === 0
              ? "No conversation history yet."
              : `${entries.length} message${entries.length === 1 ? "" : "s"}, oldest first.`}
          </p>
        </div>
        {canContact && (
          <a
            href={composeHref}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            Generate reply draft
          </a>
        )}
      </div>
      <ConversationView entries={entries} />
    </div>
  );
}
