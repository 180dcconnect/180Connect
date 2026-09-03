import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
}

/**
 * F175 — daily sweep that turns a due F160 follow-up recommendation into an
 * in-app notification for the client's owner. Same CRON_SECRET-gated shape
 * as /api/cron/stall-detection (F183): the actual work is in
 * runReminderSweep, this route only authenticates the caller.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), {
      operation: "reminder_sweep.missing_secret",
    });
    return unauthorized();
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorized();
  }
  try {
    const { runReminderSweep } = await import("@/lib/outreach/reminder-sweep");
    return NextResponse.json(await runReminderSweep());
  } catch (error) {
    await reportError(error, { operation: "reminder_sweep.run" });
    return NextResponse.json({ error: "Reminder notifications could not be processed." }, { status: 500 });
  }
}
