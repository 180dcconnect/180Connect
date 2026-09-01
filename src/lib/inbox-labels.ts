/**
 * Thread status and reply-intent vocabulary, shared by every inbox surface.
 *
 * These maps started life inside thread-list.tsx. The thread view's context
 * rail needs the identical labels and pill colours, and two copies of a label
 * map is exactly how "Awaiting follow-up" in one place becomes "Awaiting reply"
 * in another — so they live here, imported by both, and nowhere else.
 *
 * The tokens themselves are not invented here: `InboxThreadStatus` comes from
 * @/lib/outreach-inbox, and the intent keys mirror REPLY_EVENTS.intent
 * (data model 07) as listed in that module's REPLY_INTENTS.
 */

import type { InboxThreadStatus } from "./outreach-inbox.ts";

export const STATUS_LABEL: Record<InboxThreadStatus, string> = {
  replied: "Replied",
  awaiting: "Awaiting follow-up",
  sent: "Sent",
};

export const STATUS_CLASS: Record<InboxThreadStatus, string> = {
  replied: "bg-emerald-100 text-emerald-700 border-emerald-200",
  awaiting: "bg-amber-100 text-amber-700 border-amber-200",
  sent: "bg-gray-100 text-gray-500 border-gray-200",
};

export const INTENT_LABEL: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  more_info: "More info requested",
  referral: "Referral",
};

/** An unrecognised token renders as itself rather than blank or "undefined". */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status as InboxThreadStatus] ?? status;
}

export function statusClass(status: string): string {
  return STATUS_CLASS[status as InboxThreadStatus] ?? STATUS_CLASS.sent;
}

export function intentLabel(intent: string): string {
  return INTENT_LABEL[intent] ?? intent;
}
