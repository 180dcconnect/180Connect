import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { runCompaniesHouseStatusRecheck } from "@/lib/ingestion/sources/companies-house-status-recheck";

/**
 * Weekly Companies House status watch, triggered by pg_cron via net.http_post
 * (supabase/migrations/20260809100400_schedule_companies_house_cron.sql). Never
 * touches organisations.outreach_status — see the migration header on
 * 20260809100200_create_organisation_status_flags.sql for why. Same CRON_SECRET
 * check as companies-house-import/route.ts.
 */

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), {
      operation: "cron.companies_house_status_recheck",
    });
    return unauthorized();
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) {
    return unauthorized();
  }

  try {
    const result = await runCompaniesHouseStatusRecheck({ triggeredBy: "schedule" });
    return NextResponse.json(result);
  } catch (error) {
    await reportError(error, { operation: "cron.companies_house_status_recheck" });
    return NextResponse.json(
      { error: "The scheduled status recheck failed. The failure was recorded." },
      { status: 500 },
    );
  }
}
