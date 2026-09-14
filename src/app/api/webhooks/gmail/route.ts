import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { isBranchMailbox, parsePushNotification, resolveGmailPushConfig, verifyPushToken } from "@/lib/gmail/push";
import { syncGmailReplies } from "@/lib/gmail/reply-sync";

export const maxDuration = 60;

/**
 * How far back a push-triggered sync looks. A push means "the inbox just
 * changed", so only recent mail can be new; the window is generous to absorb
 * Pub/Sub retries and clock skew, and the five-minute gmail_reply_sync poll
 * (two-day lookback) remains the safety net for anything a push missed.
 */
const PUSH_WINDOW_MINUTES = 15;

/**
 * Gmail → Pub/Sub → here. See src/lib/gmail/push.ts for the whole chain.
 *
 * Status codes are Pub/Sub's retry contract: any 2xx acks, anything else is
 * redelivered with backoff. So a sync failure answers 503 (retry — capture is
 * idempotent), while a malformed or foreign-mailbox message is acked with 204
 * (retrying it can never succeed).
 */
export async function POST(request: Request) {
  const config = resolveGmailPushConfig();
  if (!config) {
    await reportError(new Error("Gmail push is not configured"), { operation: "gmail.push.route" });
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  if (!(await verifyPushToken(request.headers.get("authorization"), config))) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const notification = parsePushNotification(await request.json().catch(() => null));
  if (!notification || !isBranchMailbox(notification.emailAddress)) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    await syncGmailReplies(undefined, { sinceMinutes: PUSH_WINDOW_MINUTES });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    await reportError(error, { operation: "gmail.push.sync", historyId: notification.historyId });
    return NextResponse.json({ error: "Replies could not be synchronised." }, { status: 503 });
  }
}
