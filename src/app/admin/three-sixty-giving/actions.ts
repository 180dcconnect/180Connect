"use server";

import { revalidatePath } from "next/cache";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import {
  drainBackfillQueue,
  BACKFILL_BATCH_SIZE,
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
  void formData; // no inputs — the queue decides what is next

  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  try {
    const result = await drainBackfillQueue({
      trigger: { triggeredBy: "manual", triggeredByUserId: authorization.actor.id },
    });

    revalidatePath("/admin/three-sixty-giving");

    if (result.walked === 0) {
      return {
        kind: "success",
        message: "Nothing is due — every organisation has been checked recently.",
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
        `Checked ${result.walked.toLocaleString()} organisation${result.walked === 1 ? "" : "s"}, ` +
        `${result.grantsMatched} grant${result.grantsMatched === 1 ? "" : "s"} added. ` +
        (result.remaining > 0
          ? `${result.remaining.toLocaleString()} still queued — the scheduled job continues automatically.`
          : "The queue is now clear."),
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
        "The batch could not be run. The failure was recorded — the scheduled job will try again.",
    };
  }
}

/** Exposed so the screen can say how big a slice the button will take. */
export async function backfillBatchSize(): Promise<number> {
  return BACKFILL_BATCH_SIZE;
}
