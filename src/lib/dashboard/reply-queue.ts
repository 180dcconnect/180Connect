/**
 * The reply queue — how many client replies are sitting unanswered, and for how
 * long.
 *
 * The inbox (F131/F242 thread view) already knows this per thread via
 * `threadStatus`, but nothing on the dashboard says it, and an unanswered reply
 * is the single most expensive thing to leave rotting: the client did the hard
 * part and we went quiet. This is that same "replied" state counted across the
 * pipeline.
 *
 * Definition, matching `threadStatus` in ../outreach-inbox.ts rather than
 * inventing a second one: a client is awaiting a reply from us when its newest
 * event is a received reply — i.e. its latest reply is newer than our latest
 * sent email (or we never sent one after the reply). "Fresh in the last 48h"
 * (`isRecentReply`) is deliberately NOT the rule here: that flag is a highlight
 * for the inbox list, and a reply becomes *more* urgent as it ages, not less.
 *
 * Window: the caller passes the rows it already loaded for the Performance
 * section, which is a trailing 90 days. A reply left unanswered for longer than
 * that is not an inbox item any more, it is a dead lead — and the Needs
 * Attention panel (F027/F160) is the thing that surfaces those.
 */

export type QueueMessageRow = {
  sent_at: string | null;
  organisation_id: string;
};

export type QueueReplyRow = {
  received_at: string;
  organisation_id: string;
};

/** Owner lookup for the mine/team split. */
export type QueueOrgRow = {
  id: string;
  legal_name: string;
  owner_id: string | null;
};

export type AwaitingReplyClient = {
  organisationId: string;
  legalName: string;
  /** ISO instant of the reply that is waiting on us. */
  repliedAt: string;
  /** Whole days it has been waiting, floored. */
  daysWaiting: number;
  ownerId: string | null;
};

export type ReplyQueueSummary = {
  /** Clients awaiting our reply across the whole visible pipeline. */
  team: number;
  /** Of those, the ones this actor owns. */
  mine: number;
  /** Longest wait among this actor's own, in whole days; null when they have none. */
  myOldestDaysWaiting: number | null;
  /** This actor's own, longest-waiting first — the list the card renders. */
  myClients: AwaitingReplyClient[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Latest parseable timestamp in a list, as epoch ms; null when none parse. */
function latest(values: Iterable<string | null | undefined>): number | null {
  let newest: number | null = null;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) continue;
    if (newest === null || parsed > newest) newest = parsed;
  }
  return newest;
}

/**
 * Clients whose newest event is a client reply, newest-reply-first within the
 * caller's window.
 *
 * Organisations absent from `orgs` are dropped, the same convention
 * ../recent-updates.ts and ../outreach-inbox.ts use — that is how suppressed
 * and otherwise invisible clients stay out of a count the CAM would act on.
 */
export function awaitingReplyClients(
  messages: readonly QueueMessageRow[],
  replies: readonly QueueReplyRow[],
  orgs: readonly QueueOrgRow[],
  now: Date = new Date(),
): AwaitingReplyClient[] {
  const orgById = new Map(orgs.map((row) => [row.id, row]));

  const lastSentByOrg = new Map<string, string[]>();
  for (const message of messages) {
    if (!orgById.has(message.organisation_id)) continue;
    const list = lastSentByOrg.get(message.organisation_id);
    if (list) list.push(message.sent_at ?? "");
    else lastSentByOrg.set(message.organisation_id, [message.sent_at ?? ""]);
  }

  const repliesByOrg = new Map<string, string[]>();
  for (const reply of replies) {
    if (!orgById.has(reply.organisation_id)) continue;
    const list = repliesByOrg.get(reply.organisation_id);
    if (list) list.push(reply.received_at);
    else repliesByOrg.set(reply.organisation_id, [reply.received_at]);
  }

  const nowMs = now.getTime();
  const waiting: AwaitingReplyClient[] = [];

  for (const [organisationId, replyTimes] of repliesByOrg) {
    const newestReply = latest(replyTimes);
    if (newestReply === null) continue;

    const newestSent = latest(lastSentByOrg.get(organisationId) ?? []);
    // Our reply already went out after theirs — the ball is back with them.
    if (newestSent !== null && newestSent >= newestReply) continue;

    const org = orgById.get(organisationId);
    if (!org) continue;

    waiting.push({
      organisationId,
      legalName: org.legal_name,
      repliedAt: new Date(newestReply).toISOString(),
      daysWaiting: Math.max(0, Math.floor((nowMs - newestReply) / DAY_MS)),
      ownerId: org.owner_id,
    });
  }

  return waiting.sort((a, b) => {
    if (a.daysWaiting !== b.daysWaiting) return b.daysWaiting - a.daysWaiting;
    return a.legalName.localeCompare(b.legalName);
  });
}

/** The card's whole payload: team count, my count, my longest wait, my list. */
export function replyQueueSummary(
  messages: readonly QueueMessageRow[],
  replies: readonly QueueReplyRow[],
  orgs: readonly QueueOrgRow[],
  actorId: string,
  now: Date = new Date(),
): ReplyQueueSummary {
  const all = awaitingReplyClients(messages, replies, orgs, now);
  const myClients = all.filter((client) => client.ownerId === actorId);

  return {
    team: all.length,
    mine: myClients.length,
    myOldestDaysWaiting: myClients.length > 0 ? myClients[0].daysWaiting : null,
    myClients,
  };
}
