import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { runCharityCommissionStatusRecheck } from "@/lib/ingestion/sources/charity-commission-status-recheck";

/**
 * Weekly Charity Commission status watch (F049), triggered by pg_cron via
 * net.http_post (supabase/migrations/20260811090200_schedule_charity_commission_cron.sql).
 * Never touches organisations.outreach_status — see the migration header on
 * 20260809100200_create_organisation_status_flags.sql for why. Same CRON_SECRET
 * check as every other cron route.
 */

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), {
      operation: "cron.charity_commission_status_recheck",
    });
    return unauthorized();
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) {
    return unauthorized();
  }

  try {
    const result = await runCharityCommissionStatusRecheck({ triggeredBy: "schedule" });
    return NextResponse.json(result);
  } catch (error) {
    await reportError(error, { operation: "cron.charity_commission_status_recheck" });
    return NextResponse.json(
      { error: "The scheduled status recheck failed. The failure was recorded." },
      { status: 500 },
    );
  }
}
