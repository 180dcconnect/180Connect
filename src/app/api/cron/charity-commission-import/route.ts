import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { runCharityCommissionDiscoveryImport } from "@/lib/ingestion/sources/charity-commission-discovery";

/**
 * Weekly Charity Commission discovery (F049), triggered by pg_cron via
 * net.http_post (supabase/migrations/20260811090200_schedule_charity_commission_cron.sql).
 * Mirrors src/app/api/cron/companies-house-import/route.ts, including the same
 * CRON_SECRET check.
 *
 * Calls the same runCharityCommissionDiscoveryImport the manual "Discover new
 * charities" button calls (src/app/admin/charity-commission/actions.ts) — no
 * import logic is duplicated between the two trigger paths.
 */

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), {
      operation: "cron.charity_commission_import",
    });
    return unauthorized();
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) {
    return unauthorized();
  }

  try {
    const result = await runCharityCommissionDiscoveryImport({ triggeredBy: "schedule" });
    return NextResponse.json({
      status: result.summary.status,
      counts: result.summary.counts,
      written: result.summary.written,
      promoteCounts: result.promoteCounts,
      promoteError: result.promoteError,
    });
  } catch (error) {
    await reportError(error, { operation: "cron.charity_commission_import" });
    return NextResponse.json({ error: "The scheduled import failed. The failure was recorded." }, { status: 500 });
  }
}
