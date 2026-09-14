// Rescoring the client book one batch at a time, driven from the browser.
//
// rescore-all.ts sweeps the whole book inside one request and has to stop at a
// 40-second budget, after which the rest waits for a manual backfill. The score
// settings screen instead calls this repeatedly: each call scores the next
// RESCORE_BATCH_SIZE clients after the last one it did and returns where it got
// to. Every call is short, so no platform timeout applies, the admin sees real
// progress between calls, and a book of any size finishes as long as the page
// stays open.

import "server-only";

// Relative imports, as in rescore.ts: shares its import chain.
import { createAdminClient } from "../supabase/admin.ts";
import { reportError } from "../error-logging.ts";
import { getActiveScoutConfig } from "./configured-weights.ts";
import { persistLatestScore } from "./persist-latest-score.ts";
import type { ScoreableOrganisation } from "./score-client.ts";

export const RESCORE_BATCH_SIZE = 100;

/** Rows persisted concurrently within a batch — same bound as rescore-all.ts. */
const CHUNK = 8;

export type RescoreBatchResult =
  | {
      ok: true;
      processed: number;
      failed: number;
      /** Pass back in for the next batch; null once there is nothing after it. */
      nextAfterId: string | null;
      done: boolean;
    }
  | { ok: false; message: string };

type BatchRow = {
  id: string;
  city: string | null;
  sector: string | null;
  outreach_status: string;
  financial_periods: { total_income: number | null; period_end: string | null }[] | null;
  grants: { count: number }[] | null;
  outreach_messages: { sent_at: string | null }[] | null;
};

/** Mirrors rescore.ts's helper: newest sent message, or null. */
function lastContactedFrom(messages: { sent_at: string | null }[] | null): string | null {
  let latest: string | null = null;
  for (const message of messages ?? []) {
    if (message.sent_at && (latest === null || message.sent_at > latest)) {
      latest = message.sent_at;
    }
  }
  return latest;
}

export async function rescoreNextBatch(afterId: string | null): Promise<RescoreBatchResult> {
  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, message: "Scores cannot be updated right now. Ask a developer to check the server setup." };
  }

  // Loaded per batch, so a batch never scores under a config older than the one
  // saved just before it started.
  const config = await getActiveScoutConfig();

  let query = admin
    .from("organisations")
    .select(
      "id, city, sector, outreach_status, financial_periods(total_income, period_end), grants(count), outreach_messages(sent_at)",
    )
    .order("sent_at", { referencedTable: "outreach_messages", ascending: false, nullsFirst: false })
    .limit(1, { referencedTable: "outreach_messages" })
    .order("id")
    .limit(RESCORE_BATCH_SIZE);
  if (afterId) query = query.gt("id", afterId);

  const { data, error } = await query.returns<BatchRow[]>();
  if (error) {
    await reportError(error, { operation: "scout_config.rescore_batch.read" });
    return { ok: false, message: "Client scores could not be read. Try again in a moment." };
  }

  const rows = data ?? [];
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < rows.length; i += CHUNK) {
    await Promise.all(
      rows.slice(i, i + CHUNK).map(async (row) => {
        const scoreable: ScoreableOrganisation = {
          city: row.city,
          sector: row.sector,
          outreach_status: row.outreach_status,
          financial_periods: row.financial_periods ?? [],
          last_contacted_at: lastContactedFrom(row.outreach_messages),
          matched_grant_count: row.grants?.[0]?.count ?? null,
        };
        const result = await persistLatestScore(admin, row.id, scoreable, config.weights, config.rules);
        if (!result.ok) {
          failed += 1;
          if (failures.length < 5) failures.push(`${row.id}: ${result.error}`);
        }
      }),
    );
  }

  if (failed > 0) {
    await reportError(new Error(`Rescore batch had ${failed} failure(s): ${failures.join("; ")}`), {
      operation: "scout_config.rescore_batch",
      weightsVersion: config.version ?? "unknown",
    });
  }

  const done = rows.length < RESCORE_BATCH_SIZE;
  return {
    ok: true,
    processed: rows.length,
    failed,
    nextAfterId: rows.length > 0 ? rows[rows.length - 1].id : afterId,
    done,
  };
}
