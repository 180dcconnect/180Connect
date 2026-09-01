/**
 * Preview of the inbox conversation view (/inbox/[orgId]), fed with realistic
 * sample data so the thread-reading experience can be reviewed without a live
 * database. Mirrors what the real route renders: the conversation oldest first,
 * the client context rail beside it, and the reply CTA.
 *
 * The reply drawer itself is NOT mounted here — it talks to real generation and
 * send endpoints, and a preview page that could send an email to a charity is
 * not a preview. The trigger is shown as a dead button so the layout is honest
 * about the space it takes.
 *
 * `?variant=sparse` renders the empty states — no owner, no notes, no files,
 * one message — which is the shape most likely to look broken and the least
 * likely to exist on staging when someone goes looking for it.
 */

import Link from "next/link";
import { Sparkles } from "lucide-react";

import { ConversationView } from "@/components/inbox/conversation-view";
import { ThreadContextRail } from "@/components/inbox/thread-context-rail";
import { buildRelationshipStats } from "@/lib/inbox-thread-context";
import type { ConversationEntry } from "@/lib/outreach-inbox";
import type { Attachment } from "@/lib/attachments";
import type { DisplayNote } from "@/lib/note-history";
import type { TimelineEntry } from "@/lib/timeline";

const SAMPLE_ENTRIES: ConversationEntry[] = [
  {
    id: "email-1",
    type: "email_sent",
    timestamp: "2026-08-24T10:00:00Z",
    actorName: "Ada Lovelace",
    subject: "Introduction: 180DC Sheffield",
    body: "Hello,\n\nI'm writing on behalf of 180DC Sheffield, a student-led consultancy that helps non-profits sharpen their strategy. We've followed Oxfam GB's work on community food security and would love to explore whether a project together could be useful.\n\nWould you be open to a short call?\n\nBest,\nAda",
    intent: null,
  },
  {
    id: "reply-1",
    type: "reply_received",
    timestamp: "2026-08-26T09:12:00Z",
    actorName: "Jamie Okafor",
    subject: null,
    body: "Hi Ada,\n\nThanks for reaching out. This sounds interesting — could you tell me a bit more about what a typical project looks like and what the time commitment would be on our side?\n\nBest,\nJamie",
    intent: "more_info",
  },
  {
    id: "email-2",
    type: "email_sent",
    timestamp: "2026-08-27T14:30:00Z",
    actorName: "Ada Lovelace",
    subject: "Re: Introduction: 180DC Sheffield",
    body: "Hi Jamie,\n\nGreat to hear back. A typical project runs 8–10 weeks with a team of 4–6 consultants. For you that would mean roughly one 45-minute call per week plus email follow-ups; the analysis and deliverable work sits with us.\n\nHappy to walk through specifics whenever suits.\n\nBest,\nAda",
    intent: null,
  },
  {
    id: "reply-2",
    type: "reply_received",
    timestamp: "2026-08-31T09:00:00Z",
    actorName: "Jamie Okafor",
    subject: null,
    body: "That commitment sounds very manageable. Let's set up a call next week — Tuesday or Thursday afternoon works for me.",
    intent: "interested",
  },
];

const SAMPLE_NOTES: DisplayNote[] = [
  {
    id: "note-1",
    content: "Jamie prefers Tuesday afternoons and asked us to keep the trustees copied on anything contractual.",
    authorName: "Ada Lovelace",
    createdAt: "2026-08-27T15:10:00Z",
    edited: false,
  },
  {
    id: "note-2",
    content: "Their food security programme is the strongest fit — mentioned twice on the intro call.",
    authorName: "Ben Phillips",
    createdAt: "2026-08-25T11:00:00Z",
    edited: true,
  },
  {
    id: "note-3",
    content: "Warm intro came via the Sheffield volunteering fair.",
    authorName: "A former team member",
    createdAt: "2026-08-12T09:30:00Z",
    edited: false,
  },
];

const SAMPLE_ATTACHMENTS: Attachment[] = [
  {
    id: "att-1",
    filename: "oxfam-gb-client-booklet.pdf",
    contentType: "application/pdf",
    sizeLabel: "1.2 MB",
    createdAt: "2026-08-24T09:00:00Z",
    uploadedByName: "Ada Lovelace",
  },
  {
    id: "att-2",
    filename: "scoping-call-notes.docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeLabel: "34 KB",
    createdAt: "2026-08-27T16:00:00Z",
    uploadedByName: "Ben Phillips",
  },
];

const SAMPLE_HANDOVERS: TimelineEntry[] = [
  {
    id: "ownership-1",
    type: "ownership_reassigned",
    timestamp: "2026-08-12T08:00:00Z",
    actorName: "Bashir Bobboi",
    summary: "Ownership moved from Ben Phillips to Ada Lovelace.",
    handover: {
      fromName: "Ben Phillips",
      toName: "Ada Lovelace",
      reason: "Ben moved to the Manchester portfolio",
    },
  },
];

/** The day the sample conversation is written against, so durations are stable. */
const SAMPLE_NOW = new Date("2026-09-01T12:00:00Z");

export default async function PreviewInboxThreadPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  const { variant } = await searchParams;
  const sparse = variant === "sparse";

  const entries = sparse ? SAMPLE_ENTRIES.slice(0, 1) : SAMPLE_ENTRIES;
  const stats = buildRelationshipStats(entries, SAMPLE_NOW);

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 rounded-lg border border-dashed border-brand/40 bg-brand/[0.04] px-4 py-2 text-xs text-muted-foreground">
          Preview with sample data — not a live thread. Real version lives at{" "}
          <code className="rounded bg-muted px-1">/inbox/[orgId]</code>.{" "}
          <Link className="underline underline-offset-2" href={sparse ? "/preview-inbox-thread" : "/preview-inbox-thread?variant=sparse"}>
            {sparse ? "Show the full thread" : "Show the empty states"}
          </Link>
        </div>
        <div className="mb-1 flex items-center gap-2 text-sm">
          <Link href="/preview-inbox" className="text-muted-foreground transition-colors hover:text-foreground">
            ← Inbox
          </Link>
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold leading-tight">Oxfam GB</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {entries.length} message{entries.length === 1 ? "" : "s"}, oldest first.
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <ConversationView entries={entries} />
            <button
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white opacity-60 shadow-sm"
              disabled
              type="button"
            >
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              Generate reply draft (inert in preview)
            </button>
          </div>

          <ThreadContextRail
            attachments={sparse ? [] : SAMPLE_ATTACHMENTS}
            attachmentsError={false}
            canAddNote={false}
            handovers={sparse ? [] : SAMPLE_HANDOVERS}
            location={sparse ? null : "Oxford, GB"}
            noteCount={sparse ? 0 : SAMPLE_NOTES.length}
            notes={sparse ? [] : SAMPLE_NOTES}
            notesError={false}
            organisationId="00000000-0000-0000-0000-000000000000"
            organisationName="Oxfam GB"
            organisationType={sparse ? null : "Charity"}
            ownerName={sparse ? null : "Ada Lovelace"}
            replyIntent={sparse ? null : "interested"}
            stats={stats}
            status={sparse ? "sent" : "replied"}
          />
        </div>
      </div>
    </div>
  );
}
