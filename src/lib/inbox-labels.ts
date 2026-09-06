/**
 * Thread status, queue bucket and reply-intent vocabulary, shared by every
 * inbox surface.
 *
 * These maps started life inside thread-list.tsx. The thread view's context
 * rail needs the identical labels and pill colours, and two copies of a label
 * map is exactly how "Awaiting follow-up" in one place becomes "Awaiting reply"
 * in another — so they live here, imported by both, and nowhere else.
 *
 * The tokens themselves are not invented here: `InboxThreadStatus` comes from
 * @/lib/outreach-inbox, `InboxQueueBucket` from @/lib/inbox-queue, and the
 * intent keys mirror REPLY_EVENTS.intent (data model 07) as listed in that
 * module's REPLY_INTENTS.
 *
 * Colour is expressed as a `Pill` tone rather than a class string. The old
 * `STATUS_CLASS` handed out `bg-emerald-100 text-emerald-700 border-emerald-200`
 * — Tailwind ramp colours, which the app's design system forbids outright
 * (docs/app-design-system.md §Colour), and a hand-assembled pill with no state
 * dot. Every consumer now renders `<Pill tone={statusTone(...)}>`, so the four
 * state tones stay the only states in the app.
 */

import type { InboxQueueBucket } from "./inbox-queue.ts";
import type { FollowUpUrgency } from "./outreach/follow-up-recommendations.ts";
import type { InboxThreadStatus } from "./outreach-inbox.ts";

/** The tones `Pill` accepts (clients/[id]/section-card.tsx). */
export type PillTone = "neutral" | "lead" | "go" | "hold" | "stop";

export const STATUS_LABEL: Record<InboxThreadStatus, string> = {
  replied: "Replied",
  awaiting: "Awaiting follow-up",
  sent: "Sent",
};

const STATUS_TONE: Record<InboxThreadStatus, PillTone> = {
  // Green is not "good" here, it is "they answered" — the state a CAM is
  // looking for when they open the inbox at all.
  replied: "go",
  awaiting: "hold",
  sent: "neutral",
};

export const INTENT_LABEL: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  more_info: "More info requested",
  referral: "Referral",
};

/**
 * Bucket names are written as what the CAM has to do, not as a state the system
 * is in: "Needs a reply", not "Replied". The inbox is a queue of actions.
 */
export const BUCKET_LABEL: Record<InboxQueueBucket, string> = {
  needs_reply: "Needs a reply",
  follow_up_due: "Follow-up due",
  awaiting_them: "Awaiting them",
};

export const BUCKET_HINT: Record<InboxQueueBucket, string> = {
  needs_reply: "They wrote back and nobody has answered yet. Oldest first.",
  follow_up_due: "Silent past the follow-up threshold in your outreach preferences.",
  awaiting_them: "Sent and still within the wait. Nothing to do yet.",
};

const FOLLOW_UP_LABEL: Record<FollowUpUrgency, string> = {
  urgent: "Follow-up overdue",
  due: "Follow-up due",
};

const FOLLOW_UP_TONE: Record<FollowUpUrgency, PillTone> = {
  urgent: "stop",
  due: "hold",
};

/** An unrecognised token renders as itself rather than blank or "undefined". */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status as InboxThreadStatus] ?? status;
}

export function statusTone(status: string): PillTone {
  return STATUS_TONE[status as InboxThreadStatus] ?? "neutral";
}

const STATUS_CLASS: Record<InboxThreadStatus, string> = {
  replied: "bg-emerald-100 text-emerald-700 border-emerald-200",
  awaiting: "bg-amber-100 text-amber-700 border-amber-200",
  sent: "bg-slate-100 text-slate-700 border-slate-200",
};

export function statusClass(status: string): string {
  return STATUS_CLASS[status as InboxThreadStatus] ?? "bg-slate-100 text-slate-700 border-slate-200";
}

export function intentLabel(intent: string): string {
  return INTENT_LABEL[intent] ?? intent;
}

export function bucketLabel(bucket: InboxQueueBucket): string {
  return BUCKET_LABEL[bucket] ?? bucket;
}

export function followUpLabel(urgency: FollowUpUrgency): string {
  return FOLLOW_UP_LABEL[urgency] ?? urgency;
}

export function followUpTone(urgency: FollowUpUrgency): PillTone {
  return FOLLOW_UP_TONE[urgency] ?? "hold";
}
