import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), { operation: "stall_sweep.missing_secret" });
    return unauthorized();
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorized();
  }
  try {
    const { runStallSweep } = await import("@/lib/outreach/stall-sweep");
    return NextResponse.json(await runStallSweep());
  } catch (error) {
    await reportError(error, { operation: "stall_sweep.run" });
    return NextResponse.json({ error: "Stall detection could not be processed." }, { status: 500 });
  }
}
