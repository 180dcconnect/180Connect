import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
}

/**
 * F176 — hourly sweep that batches new team-activity audit events into at
 * most one digest notification per active user (AC2's noise-control
 * answer). Same CRON_SECRET-gated shape as /api/cron/stall-detection (F183)
 * and /api/cron/reminder-notifications (F175): the actual work is in
 * runTeamActivitySweep, this route only authenticates the caller.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), {
      operation: "team_activity_sweep.missing_secret",
    });
    return unauthorized();
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorized();
  }
  try {
    const { runTeamActivitySweep } = await import("@/lib/team-activity-sweep");
    return NextResponse.json(await runTeamActivitySweep());
  } catch (error) {
    await reportError(error, { operation: "team_activity_sweep.run" });
    return NextResponse.json(
      { error: "Team activity notifications could not be processed." },
      { status: 500 },
    );
  }
}
