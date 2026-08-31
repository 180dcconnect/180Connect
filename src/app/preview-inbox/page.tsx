/**
 * Design-system style preview of the Outreach Inbox, fed with realistic
 * sample data so the layout, statuses, and intents can be reviewed without a
 * live database. Mirrors the exact ThreadList markup the real /inbox route
 * renders.
 */

import { ThreadList } from "@/components/inbox/thread-list";
import type { InboxThread } from "@/lib/outreach-inbox";

const SAMPLE_THREADS: InboxThread[] = [
  {
    orgId: "org-1",
    orgName: "Oxfam GB",
    href: "#",
    lastActivityAt: "2026-08-31T09:00:00Z",
    lastActorName: "The client",
    lastEventLabel: "Reply received",
    subject: "Reply from the client",
    snippet: "Thanks for reaching out — happy to chat next week about the partnership.",
    status: "replied",
    replyIntent: "interested",
    messageCount: 3,
    relativeTime: "3 hours ago",
  },
  {
    orgId: "org-2",
    orgName: "Shelter",
    href: "#",
    lastActivityAt: "2026-08-31T10:00:00Z",
    lastActorName: "Ada Lovelace",
    lastEventLabel: "Email sent",
    subject: "Follow-up: Community housing collaboration",
    snippet: "Just circling back on my previous email — let me know if you need anything else.",
    status: "awaiting",
    replyIntent: null,
    messageCount: 2,
    relativeTime: "2 hours ago",
  },
  {
    orgId: "org-3",
    orgName: "WWF UK",
    href: "#",
    lastActivityAt: "2026-08-29T14:30:00Z",
    lastActorName: "The client",
    lastEventLabel: "Reply received",
    subject: "Reply from the client",
    snippet: "Could you send over more details about the programme timeline?",
    status: "replied",
    replyIntent: "more_info",
    messageCount: 2,
    relativeTime: "2 days ago",
  },
  {
    orgId: "org-4",
    orgName: "RSPB",
    href: "#",
    lastActivityAt: "2026-08-28T11:00:00Z",
    lastActorName: "Ada Lovelace",
    lastEventLabel: "Email sent",
    subject: "Introduction: 180DC Sheffield",
    snippet: "Hello, I'm writing to introduce our consultancy and explore potential synergy.",
    status: "sent",
    replyIntent: null,
    messageCount: 1,
    relativeTime: "3 days ago",
  },
  {
    orgId: "org-5",
    orgName: "Save the Children UK",
    href: "#",
    lastActivityAt: "2026-08-25T09:15:00Z",
    lastActorName: "The client",
    lastEventLabel: "Reply received",
    subject: "Reply from the client",
    snippet: "After careful consideration we won't be able to move forward at this time.",
    status: "replied",
    replyIntent: "not_interested",
    messageCount: 2,
    relativeTime: "27 August 2026",
  },
  {
    orgId: "org-6",
    orgName: "National Trust",
    href: "#",
    lastActivityAt: "2026-08-20T16:45:00Z",
    lastActorName: "The client",
    lastEventLabel: "Reply received",
    subject: "Reply from the client",
    snippet: "My colleague Priya handles this area — copying her in here.",
    status: "replied",
    replyIntent: "referral",
    messageCount: 2,
    relativeTime: "22 August 2026",
  },
];

export default function PreviewInboxPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 rounded-lg border border-dashed border-brand/40 bg-brand/[0.04] px-4 py-2 text-xs text-muted-foreground">
          Preview with sample data — not live outreach. Real version lives at{" "}
          <code className="rounded bg-muted px-1">/inbox</code>.
        </div>
        <h1 className="text-2xl font-bold mb-1">Outreach Inbox</h1>
        <p className="text-sm text-muted-foreground mb-6">
          All outreach threads, newest activity first. Click a thread to open the client page.
        </p>
        <ThreadList threads={SAMPLE_THREADS} />
      </div>
    </div>
  );
}
