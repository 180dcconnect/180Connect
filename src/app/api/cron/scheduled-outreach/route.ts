import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { sendDueReviewedEmails } from "@/lib/outreach/scheduled-worker";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  try {
    return NextResponse.json(await sendDueReviewedEmails());
  } catch (error) {
    await reportError(error, { operation: "outreach.scheduler.run" });
    return NextResponse.json({ error: "Scheduled outreach could not be processed." }, { status: 500 });
  }
}
