import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), { operation: "no_response_sweep.missing_secret" });
    return unauthorized();
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorized();
  }

  const admin = createAdminClient();
  if (!admin) {
    await reportError(new Error("No admin client available"), { operation: "no_response_sweep.no_admin_client" });
    return NextResponse.json({ error: "No-response sweep could not be processed." }, { status: 500 });
  }

  const { data, error } = await admin.rpc("sweep_no_response_status");
  if (error) {
    await reportError(error, { operation: "no_response_sweep.run" });
    return NextResponse.json({ error: "No-response sweep could not be processed." }, { status: 500 });
  }
  return NextResponse.json({ transitioned: data });
}
