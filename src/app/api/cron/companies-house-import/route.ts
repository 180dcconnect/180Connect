import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { runCompaniesHouseDiscoveryImport } from "@/lib/ingestion/sources/companies-house-discovery";

/**
 * Weekly Companies House discovery, triggered by pg_cron via net.http_post
 * (supabase/migrations/20260809100400_schedule_companies_house_cron.sql). This is
 * the first real consumer of CRON_SECRET (src/lib/env.ts) — declared before this
 * feature but previously unconsumed (docs/open-questions.md Q-02).
 *
 * Calls the same runCompaniesHouseDiscoveryImport the manual "Import" button
 * calls (src/app/admin/companies-house/actions.ts) — no import logic is
 * duplicated between the two trigger paths.
 */

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), {
      operation: "cron.companies_house_import",
    });
    return unauthorized();
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) {
    return unauthorized();
  }

  try {
    const result = await runCompaniesHouseDiscoveryImport({ triggeredBy: "schedule" });
    return NextResponse.json({
      status: result.summary.status,
      counts: result.summary.counts,
      written: result.summary.written,
      promoteCounts: result.promoteCounts,
      promoteError: result.promoteError,
    });
  } catch (error) {
    await reportError(error, { operation: "cron.companies_house_import" });
    return NextResponse.json({ error: "The scheduled import failed. The failure was recorded." }, { status: 500 });
  }
}
