"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";
import {
  parseAttemptProgress,
  type AttemptRunRow,
} from "@/lib/ingestion/attempt-progress";
import type { JobStatus } from "@/lib/ingestion/type";
import {
  drainBackfillQueue,
  resolveManualBatchSize,
} from "@/lib/ingestion/three-sixty-giving-backfill";

/**
 * The 360Giving admin screen's one action: run a queue slice now.
 *
 * ── What replaced what ──
 *
 * This page used to offer two buttons: a bulk walk of every known identifier,
 * and a single-charity lookup by registration number. Both are gone.
 *
 * The bulk walk could not finish. It made one request per organisation at 600ms
 * (360Giving allows 2/second), which is ~16 minutes against a 300s ceiling, so
 * it died partway through every time — and because a partial walk looks exactly
 * like a complete one that found nothing, it died quietly. The queue in
 * three-sixty-giving-backfill.ts does that work properly now, a slice every 15
 * minutes, and this button just runs the next slice early.
 *
 * The single lookup moved to the client record itself, where the question
 * actually gets asked (`fetchGrantsForClient` in clients/[id]/grant-history-actions.ts).
 * Asking an admin to copy a registration number onto a different screen to learn
 * something about a charity they already had open was the wrong shape.
 *
 * ── Why the button walks less than the cron ──
 *
 * `drainBackfillQueue` defaults to BACKFILL_BATCH_SIZE (200, ~3 minutes of
 * rate-limited requests). That is fine for the 15-minute cron, which nobody
 * watches — but a Server Action behind `useActionState` has no progress
 * events, only a pending boolean, so a 3-minute slice looks exactly like a
 * hung button. This action therefore walks the slice size from the form
 * (default MANUAL_BACKFILL_BATCH_SIZE, capped at MANUAL_BACKFILL_MAX) and
 * leaves the big slices to the schedule.
 * (Server Actions inherit `maxDuration` from the page, which sets 300s —
 * the limit here is human patience, not the function ceiling.)
 */

export type BackfillState = {
  kind: "idle" | "success" | "error";
  message: string;
  progress?: { walked: number; grants: number; remaining: number; total: number };
};

export async function runBackfillBatchNow(
  previous: BackfillState,
  formData: FormData,
): Promise<BackfillState> {
  void previous;
  // The only input: how many organisations this press should walk. Resolved
  // through the clamped helper, so a missing or tampered value safely falls
  // back to the default rather than widening the slice.
  const batchSize = resolveManualBatchSize(formData.get("batchSize"));

  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  try {
    const result = await drainBackfillQueue({
      batchSize,
      trigger: { triggeredBy: "manual", triggeredByUserId: authorization.actor.id },
    });

    revalidatePath("/admin/three-sixty-giving");

    if (result.walked === 0) {
      return {
        kind: "success",
        message: "Nothing to do — every client has already been checked recently.",
        progress: {
          walked: 0,
          grants: 0,
          remaining: result.remaining,
          total: result.total,
        },
      };
    }

    return {
      kind: "success",
      message:
        `Checked ${result.walked.toLocaleString()} client${result.walked === 1 ? "" : "s"}, ` +
        `${result.grantsMatched} grant${result.grantsMatched === 1 ? "" : "s"} added. ` +
        (result.remaining > 0
          ? `${result.remaining.toLocaleString()} still to check — the system will keep working through them on its own.`
          : "That's everything — all clients are now checked."),
      progress: {
        walked: result.walked,
        grants: result.grantsMatched,
        remaining: result.remaining,
        total: result.total,
      },
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.three_sixty_giving.backfill",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message:
        "This check couldn't finish. It has been logged — the automatic checks will try again.",
    };
  }
}

const attemptStatusSchema = z.object({
  // ISO timestamp of when the button was pressed. Selects the manual run this
  // admin started — latest first, so a previous press never shadows the live one.
  since: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid timestamp."),
});

export type BackfillAttemptStatus =
  | { ok: true; found: false }
  | {
      ok: true;
      found: true;
      status: JobStatus;
      walked: number | null;
      total: number | null;
      startedAt: string;
    }
  | { ok: false; message: string };

/**
 * Polls the live state of the backfill attempt the button started.
 *
 * A read, not a mutation, but it lives in this "use server" file because the
 * project has no API routes — same precedent as `loadMoreGrants` in
 * clients/[id]/grant-history-actions.ts. The client calls it every couple of
 * seconds while `runBackfillBatchNow` is in flight (a separate request — the
 * browser holds the action's connection open while polls ride alongside) and
 * renders the runner's per-organisation heartbeats as "asked X of Y".
 */
export async function getBackfillAttemptStatus(
  input: unknown,
): Promise<BackfillAttemptStatus> {
  const parsed = safeValidate(attemptStatusSchema, input);
  if (!parsed.success) {
    return { ok: false, message: "That status could not be requested." };
  }

  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("id, started_at, job_status, run_stats")
    .eq("api_source", "360giving")
    .eq("triggered_by", "manual")
    .eq("triggered_by_user_id", authorization.actor.id)
    .gte("started_at", parsed.data.since)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    await reportError(error, {
      operation: "admin.three_sixty_giving.attempt_status",
      actorUserId: authorization.actor.id,
    });
    return { ok: false, message: "Progress could not be loaded." };
  }

  if (!data) return { ok: true, found: false };

  const row = data as AttemptRunRow;
  const { walked, total } = parseAttemptProgress(row);
  return {
    ok: true,
    found: true,
    status: row.job_status,
    walked,
    total,
    startedAt: row.started_at,
  };
}
