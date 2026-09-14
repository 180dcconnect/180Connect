import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { renewGmailWatch } from "@/lib/gmail/push";

/**
 * Renews the Gmail inbox watch behind push reply sync (src/lib/gmail/push.ts).
 * Gmail drops a watch after 7 days; pg_cron calls this twice a day
 * (gmail_watch_renew), so a couple of failed runs still leave days of margin.
 * Also the route to call once by hand right after setup, to start the watch.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), { operation: "gmail.watch.route" });
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  try {
    const watch = await renewGmailWatch();
    // Push is optional (it needs Pub/Sub IAM grants in the Gmail OAuth
    // project). Unconfigured is the normal state, not an error — replies then
    // arrive via the gmail_reply_check Edge Function instead.
    if (!watch) return NextResponse.json({ skipped: "Gmail push is not configured." });
    return NextResponse.json(watch);
  } catch (error) {
    await reportError(error, { operation: "gmail.watch.renew" });
    return NextResponse.json({ error: "The Gmail watch could not be renewed." }, { status: 503 });
  }
}
