export type ReplyTrackingRow = {
  id: string;
  organisation_id: string;
  response_time_seconds?: number | null;
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
  averageResponseTimeSeconds: number | null;
  responseTimeByClient: ReadonlyMap<string, ResponseTimeAggregate>;
  responseTimeByCam: ReadonlyMap<string, ResponseTimeAggregate>;
};

export type ResponseTimeAggregate = {
  attempts: number;
  totalSeconds: number;
  averageSeconds: number;
};

function addResponseTime(
  aggregates: Map<string, { attempts: number; totalSeconds: number }>,
  key: string,
  seconds: number,
) {
  const current = aggregates.get(key) ?? { attempts: 0, totalSeconds: 0 };
  aggregates.set(key, {
    attempts: current.attempts + 1,
    totalSeconds: current.totalSeconds + seconds,
  });
}

function finishResponseTimes(
  source: ReadonlyMap<string, { attempts: number; totalSeconds: number }>,
): ReadonlyMap<string, ResponseTimeAggregate> {
  return new Map(
    Array.from(source, ([key, value]) => [
      key,
      { ...value, averageSeconds: value.totalSeconds / value.attempts },
    ]),
  );
}

export function averageResponseTime(
  replies: readonly Pick<ReplyTrackingRow, "response_time_seconds">[],
): number | null {
  const durations = replies
    .map((reply) => reply.response_time_seconds)
    .filter((seconds): seconds is number =>
      typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0,
    );
  if (durations.length === 0) return null;
  return durations.reduce((total, seconds) => total + seconds, 0) / durations.length;
}

export function formatResponseTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "Not available";
  const roundedMinutes = Math.round(seconds / 60);
  if (roundedMinutes < 60) return `${roundedMinutes} min`;
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours < 24) return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0
    ? `${days} day${days === 1 ? "" : "s"}`
    : `${days} day${days === 1 ? "" : "s"} ${remainingHours} hr`;
}

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
  const clientResponseTimes = new Map<string, { attempts: number; totalSeconds: number }>();
  const camResponseTimes = new Map<string, { attempts: number; totalSeconds: number }>();
  let unassigned = 0;

  for (const reply of replies) {
    if (seenReplyIds.has(reply.id) || !ownerByClient.has(reply.organisation_id)) continue;
    seenReplyIds.add(reply.id);
    byClient.set(reply.organisation_id, (byClient.get(reply.organisation_id) ?? 0) + 1);

    const ownerId = ownerByClient.get(reply.organisation_id);
    if (ownerId) byCam.set(ownerId, (byCam.get(ownerId) ?? 0) + 1);
    else unassigned += 1;

    const seconds = reply.response_time_seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
      addResponseTime(clientResponseTimes, reply.organisation_id, seconds);
      if (ownerId) addResponseTime(camResponseTimes, ownerId, seconds);
    }
  }

  return {
    totalReplies: seenReplyIds.size,
    respondingClients: byClient.size,
    byClient,
    byCam,
    unassigned,
    averageResponseTimeSeconds: averageResponseTime(replies),
    responseTimeByClient: finishResponseTimes(clientResponseTimes),
    responseTimeByCam: finishResponseTimes(camResponseTimes),
  };
}
