import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { sendDueReviewedEmails } from "@/lib/outreach/scheduled-worker";

/**
 * F126 (#122): deliver due scheduled outreach emails, triggered by pg_cron via
 * net.http_post every five minutes
 * (supabase/migrations/20260902120100_schedule_scheduled_outreach_cron.sql) —
 * same convention as the Companies House and Charity Commission jobs
 * (20260811090200_schedule_charity_commission_cron.sql), including the Vercel
 * deployment-protection bypass query param and the shared vault secrets.
 *
 * Calls sendDueReviewedEmails directly — no send logic is duplicated between
 * this trigger path and anything else; the worker is the only thing that ever
 * delivers a scheduled email.
 */

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorized();
  }
  try {
    return NextResponse.json(await sendDueReviewedEmails());
  } catch (error) {
    await reportError(error, { operation: "outreach.scheduler.run" });
    return NextResponse.json({ error: "Scheduled outreach could not be processed." }, { status: 500 });
  }
}
