// F097: database-backed half of the send-time snapshot builder.
//
// Separate from send-snapshot.ts (the pure assembler) because that file sits
// on unit-test import chains that run under plain `node --test` and cannot
// resolve "server-only" or the admin client. This module is imported only by
// the two production send paths.
//
// Best-effort by contract, mirroring rescore.ts: a snapshot that cannot be
// built must never fail the send. The RPC treats a null p_score_snapshot as
// "no row" — a visible gap in the training set (no vector for that message)
// rather than a wrong one, and the failure lands in ERROR_LOG here.
//
// The org read mirrors rescore.ts's query exactly on purpose: a snapshot and a
// live rescore of the same client must never disagree about what the inputs
// were, or one of them is mislabeled data.

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/error-logging";
import { getActiveScoutConfig } from "./configured-weights.ts";
import { assembleScoreSnapshot, type ScoreSnapshotPayload } from "./send-snapshot.ts";
import type { ScoreableOrganisation } from "./score-client.ts";

type OrgRow = {
  city: string | null;
  sector: string | null;
  outreach_status: string;
  total_income: number | null;
  financial_periods: { total_income: number | null; period_end: string | null }[] | null;
  grants: { count: number }[] | null;
  outreach_messages: { sent_at: string | null }[] | null;
};

function lastContactedFrom(
  messages: { sent_at: string | null }[] | null,
): string | null {
  let latest: string | null = null;
  for (const message of messages ?? []) {
    if (message.sent_at && (latest === null || message.sent_at > latest)) {
      latest = message.sent_at;
    }
  }
  return latest;
}

/**
 * Builds the score snapshot payload for one organisation from current database
 * state plus the active SCOUT generation. Returns null (after logging) when
 * anything upstream fails — the send proceeds without a training row.
 */
export async function buildScoreSnapshot(
  organisationId: string,
): Promise<ScoreSnapshotPayload | null> {
  const admin = createAdminClient();
  if (!admin) {
    await reportError(new Error("Service-role client unavailable; score snapshot skipped"), {
      operation: "score_snapshot.build",
      organisationId,
    });
    return null;
  }

  const [{ data: org, error }, config] = await Promise.all([
    admin
      .from("organisations")
      .select(
        "city, sector, outreach_status, total_income, financial_periods(total_income, period_end), grants(count), outreach_messages(sent_at)",
      )
      .order("sent_at", {
        referencedTable: "outreach_messages",
        ascending: false,
        nullsFirst: false,
      })
      .limit(1, { referencedTable: "outreach_messages" })
      .eq("id", organisationId)
      .maybeSingle<OrgRow>(),
    getActiveScoutConfig(),
  ]);

  if (error) {
    await reportError(error, { operation: "score_snapshot.build", organisationId });
    return null;
  }
  if (!org) {
    await reportError(new Error("Organisation not found; score snapshot skipped"), {
      operation: "score_snapshot.build",
      organisationId,
    });
    return null;
  }

  const scoreable: ScoreableOrganisation = {
    city: org.city,
    sector: org.sector,
    outreach_status: org.outreach_status,
    total_income: org.total_income,
    financial_periods: org.financial_periods ?? [],
    last_contacted_at: lastContactedFrom(org.outreach_messages),
    matched_grant_count: org.grants?.[0]?.count ?? null,
  };

  return assembleScoreSnapshot(scoreable, config);
}
