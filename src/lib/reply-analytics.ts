export type ReplyTrackingRow = {
  id: string;
  organisation_id: string;
};

export type ReplyOwnerRow = {
  id: string;
  owner_id: string | null;
};

export type ReplyTrackingSummary = {
  totalReplies: number;
  respondingClients: number;
  byClient: ReadonlyMap<string, number>;
  byCam: ReadonlyMap<string, number>;
  unassigned: number;
};

/**
 * F138 — reply_events only contains successfully linked replies. Gmail messages
 * that could not be linked are retained by F132's separate manual-review path,
 * so they cannot accidentally inflate these success counts.
 */
export function summariseTrackedReplies(
  replies: readonly ReplyTrackingRow[],
  organisations: readonly ReplyOwnerRow[],
): ReplyTrackingSummary {
  const ownerByClient = new Map(organisations.map((row) => [row.id, row.owner_id]));
  const seenReplyIds = new Set<string>();
  const byClient = new Map<string, number>();
  const byCam = new Map<string, number>();
  let unassigned = 0;

  for (const reply of replies) {
    if (seenReplyIds.has(reply.id) || !ownerByClient.has(reply.organisation_id)) continue;
    seenReplyIds.add(reply.id);
    byClient.set(reply.organisation_id, (byClient.get(reply.organisation_id) ?? 0) + 1);

    const ownerId = ownerByClient.get(reply.organisation_id);
    if (ownerId) byCam.set(ownerId, (byCam.get(ownerId) ?? 0) + 1);
    else unassigned += 1;
  }

  return {
    totalReplies: seenReplyIds.size,
    respondingClients: byClient.size,
    byClient,
    byCam,
    unassigned,
  };
}
