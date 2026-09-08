import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-logging";

/**
 * Daily provenance-gap audit, triggered by pg_cron via net.http_post
 * (supabase/migrations/20260923105000_create_provenance_audit_rpc.sql + the
 * paired schedule migration). Flags API-created clients with no contributing
 * register — a Data Sources card with nothing on it — and records the flagged
 * set in audit_log when it changes. Same CRON_SECRET check as every other cron
 * route; the sweep runs as service_role.
 */

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    await reportError(new Error("CRON_SECRET is not configured"), {
      operation: "cron.provenance_audit",
    });
    return unauthorized();
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) {
    return unauthorized();
  }

  try {
    const { runProvenanceAudit } = await import("@/lib/ingestion/provenance-audit");
    return NextResponse.json(await runProvenanceAudit());
  } catch (error) {
    await reportError(error, { operation: "cron.provenance_audit" });
    return NextResponse.json(
      { error: "The provenance audit could not be processed. The failure was recorded." },
      { status: 500 },
    );
  }
}
