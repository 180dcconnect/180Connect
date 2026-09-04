import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { drainBackfillQueue } from "@/lib/ingestion/three-sixty-giving-backfill";

/**
 * Drains one slice of the 360Giving grants queue.
 *
 * Runs often and does very little each time. That is the design rather than a
 * compromise: a full walk of the client list needs ~16 minutes against a 300s
 * ceiling (the arithmetic is in three-sixty-giving-backfill.ts), so the work is
 * spread across invocations instead of being crammed into one that cannot hold
 * it. Once the queue is empty a run makes no API calls at all and returns in a
 * single query, so a frequent schedule costs nothing to keep.
 *
 * Same CRON_SECRET check as every other cron route.
 */

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), {
      operation: "cron.three_sixty_giving_backfill",
    });
    return unauthorized();
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) {
    return unauthorized();
  }

  try {
    const result = await drainBackfillQueue({ trigger: { triggeredBy: "schedule" } });
    return NextResponse.json(result);
  } catch (error) {
    await reportError(error, { operation: "cron.three_sixty_giving_backfill" });
    return NextResponse.json(
      { error: "The 360Giving backfill failed. The failure was recorded." },
      { status: 500 },
    );
  }
}
