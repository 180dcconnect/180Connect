import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { syncGmailReplies } from "@/lib/gmail/reply-sync";

export const maxDuration = 300;

/**
 * `?sinceMinutes=` narrows the run to recent mail. The gmail-reply-check Edge
 * Function (supabase/functions/gmail-reply-check) passes it when it has
 * already seen a new message, so the run costs one short list instead of the
 * full lookback. Absent — the five-minute safety-net poll — keeps the
 * GMAIL_REPLY_LOOKBACK_DAYS window.
 */
function sinceMinutesFrom(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get("sinceMinutes");
  const value = Number(raw);
  return raw && Number.isInteger(value) && value >= 1 && value <= 60 ? value : undefined;
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), {
      operation: "gmail.reply_sync.route",
    });
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  try {
    return NextResponse.json(await syncGmailReplies(undefined, { sinceMinutes: sinceMinutesFrom(request) }));
  } catch (error) {
    await reportError(error, { operation: "gmail.reply_sync.route" });
    return NextResponse.json({ error: "Gmail replies could not be synchronised." }, { status: 503 });
  }
}
