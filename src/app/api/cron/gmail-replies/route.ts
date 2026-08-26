import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { syncGmailReplies } from "@/lib/gmail/reply-sync";

export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  try {
    return NextResponse.json(await syncGmailReplies());
  } catch (error) {
    await reportError(error, { operation: "gmail.reply_sync.route" });
    return NextResponse.json({ error: "Gmail replies could not be synchronised." }, { status: 503 });
  }
}
