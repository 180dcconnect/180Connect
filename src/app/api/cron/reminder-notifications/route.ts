import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
}

/**
 * The daily notifications job. Two sweeps, in order:
 *
 * 1. F175 — turns a due F160 follow-up recommendation into an in-app
 *    notification for the client's owner (runReminderSweep).
 * 2. The daily/weekly digest emails (runNotificationDigestSweep). Second, so
 *    follow-ups due this morning are in this morning's digest.
 *
 * Called at 08:00 and 09:00 UTC (20261004140000) so one call is 9am UK time in
 * both BST and GMT. Digests send only on that one; reminders run on both,
 * which is safe because the reminder sweep never repeats a reminder.
 *
 * One route for both rather than a route each: Vercel Hobby allows 12
 * functions and every cron route is one. Each sweep fails on its own — a
 * broken digest never costs anyone their reminders, or the reverse — and the
 * response is a 500 if either failed. Same CRON_SECRET-gated shape as
 * /api/cron/stall-detection (F183); this route only authenticates the caller.
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
  const result: Record<string, unknown> = {};
  let failed = false;

  try {
    const { runReminderSweep } = await import("@/lib/outreach/reminder-sweep");
    result.reminders = await runReminderSweep();
  } catch (error) {
    failed = true;
    await reportError(error, { operation: "reminder_sweep.run" });
    result.reminders = { error: "Reminder notifications could not be processed." };
  }

  try {
    const { runNotificationDigestSweep } = await import("@/lib/notification-digest-sweep");
    result.digests = await runNotificationDigestSweep();
  } catch (error) {
    failed = true;
    await reportError(error, { operation: "notification_digest.run" });
    result.digests = { error: "Notification digests could not be sent." };
  }

  return NextResponse.json(result, { status: failed ? 500 : 200 });
}
