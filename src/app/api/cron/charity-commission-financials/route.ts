import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { runCharityCommissionFinancialRefresh } from "@/lib/ingestion/sources/charity-commission-financial-refresh";

/**
 * Weekly Charity Commission financial refresh, triggered by pg_cron via
 * net.http_post (supabase/migrations/20260922092000_schedule_charity_commission_financials_cron.sql).
 *
 * Keeps FINANCIAL_PERIODS current for charities we already hold — the discovery
 * job only ever sees newly registered charities, which by definition have filed
 * nothing yet. Same CRON_SECRET check as every other cron route.
 *
 * `budgetExhausted` in the response means the run stopped on its history-call
 * budget and there is more to fetch; the next run continues, because what needs
 * fetching is derived from what is stored rather than from a cursor.
 */

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), {
      operation: "cron.charity_commission_financials",
    });
    return unauthorized();
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) {
    return unauthorized();
  }

  try {
    const result = await runCharityCommissionFinancialRefresh();
    return NextResponse.json(result);
  } catch (error) {
    await reportError(error, { operation: "cron.charity_commission_financials" });
    return NextResponse.json(
      { error: "The scheduled financial refresh failed. The failure was recorded." },
      { status: 500 },
    );
  }
}
