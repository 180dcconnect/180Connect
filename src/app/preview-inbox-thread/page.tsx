/**
 * Preview of the inbox conversation view (/inbox/[orgId]), fed with realistic
 * sample data so the thread-reading experience can be reviewed without a live
 * database. Mirrors what the real route renders: full past of the
 * conversation, oldest first, plus the "Generate reply draft" CTA.
 */

import Link from "next/link";
import { Sparkles } from "lucide-react";

import { ConversationView } from "@/components/inbox/conversation-view";
import type { ConversationEntry } from "@/lib/outreach-inbox";

const SAMPLE_ENTRIES: ConversationEntry[] = [
  {
    id: "email-1",
    type: "email_sent",
    timestamp: "2026-08-24T10:00:00Z",
    actorName: "Ada Lovelace",
    subject: "Introduction: 180DC Sheffield",
    body: "Hello,\n\nI'm writing on behalf of 180DC Sheffield, a student-led consultancy that helps non-profits sharpen their strategy. We've followed Oxfam GB's work on community food security and would love to explore whether a project together could be useful.\n\nWould you be open to a short call?\n\nBest,\nAda",
  },
  {
    id: "reply-1",
    type: "reply_received",
    timestamp: "2026-08-26T09:12:00Z",
    actorName: "The client",
    subject: null,
    body: "Hi Ada,\n\nThanks for reaching out. This sounds interesting — could you tell me a bit more about what a typical project looks like and what the time commitment would be on our side?\n\nBest,\nJamie",
  },
  {
    id: "email-2",
    type: "email_sent",
    timestamp: "2026-08-27T14:30:00Z",
    actorName: "Ada Lovelace",
    subject: "Re: Introduction: 180DC Sheffield",
    body: "Hi Jamie,\n\nGreat to hear back. A typical project runs 8–10 weeks with a team of 4–6 consultants. For you that would mean roughly one 45-minute call per week plus email follow-ups; the analysis and deliverable work sits with us.\n\nHappy to walk through specifics whenever suits.\n\nBest,\nAda",
  },
  {
    id: "reply-2",
    type: "reply_received",
    timestamp: "2026-08-31T09:00:00Z",
    actorName: "The client",
    subject: null,
    body: "That commitment sounds very manageable. Let's set up a call next week — Tuesday or Thursday afternoon works for me.",
  },
];

export default function PreviewInboxThreadPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 rounded-lg border border-dashed border-brand/40 bg-brand/[0.04] px-4 py-2 text-xs text-muted-foreground">
          Preview with sample data — not a live thread. Real version lives at{" "}
          <code className="rounded bg-muted px-1">/inbox/[orgId]</code>.
        </div>
        <div className="mb-1 flex items-center gap-2 text-sm">
          <Link href="/preview-inbox" className="text-muted-foreground transition-colors hover:text-foreground">
            ← Inbox
          </Link>
        </div>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold leading-tight">Oxfam GB</h1>
            <p className="mt-1 text-sm text-muted-foreground">4 messages, oldest first.</p>
          </div>
          <a
            href="#"
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            Generate reply draft
          </a>
        </div>
        <ConversationView entries={SAMPLE_ENTRIES} />
      </div>
    </div>
  );
}
