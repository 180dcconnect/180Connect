import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";

/**
 * Admin review queue (F032/F260 follow-on): F047's held-for-review
 * data_quality_events, and the Companies House status-watch's
 * organisation_status_flags. Same shape as /api/admin/suppressions — GET the
 * combined list, PATCH to resolve/acknowledge one item via its RPC.
 */

const patchSchema = z.object({
  type: z.enum(["data_quality_event", "status_flag"]),
  id: z.uuid(),
  note: z.string().trim().optional(),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

function rpcFailure(error: { code?: string; message?: string }): { status: number; error: string } {
  if (!error.message?.trim()) {
    return { status: 500, error: "The request could not be completed. Refresh and try again." };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    default:
      return { status: 500, error: "The request could not be completed. Refresh and try again." };
  }
}

export async function GET() {
  const authorization = await getCurrentActor("user:manage", { route: "/admin/review" });
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();

  const [events, flags, unmatchedReplies] = await Promise.all([
    supabase
      .from("data_quality_events")
      .select(
        "id, raw_source_record_id, rule_name, rule_category, field_value, severity, " +
          "suggested_fix, resolved, resolved_at, created_at, " +
          "raw_source_records ( raw_payload )",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("organisation_status_flags")
      .select(
        "id, organisation_id, company_number, previous_status, new_status, " +
          "detected_at, resolved, resolved_at, organisations ( legal_name )",
      )
      .order("detected_at", { ascending: false })
      .limit(200),
    supabase
      .from("audit_log")
      .select("id, detail, created_at")
      .eq("action", "gmail_reply_needs_review")
      .eq("target_table", "gmail_unmatched_replies")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (events.error || flags.error || unmatchedReplies.error) {
    await reportError(events.error ?? flags.error ?? unmatchedReplies.error, {
      operation: "admin.review.list",
    });
    return NextResponse.json(
      { error: "The review queue could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    events: events.data ?? [],
    flags: flags.data ?? [],
    unmatchedReplies: unmatchedReplies.data ?? [],
  });
}

export async function PATCH(request: Request) {
  const authorization = await getCurrentActor("user:manage", { route: "/admin/review" });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/review",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the request details." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { type, id, note } = parsed.data;

  const { error } =
    type === "data_quality_event"
      ? await supabase.rpc("resolve_data_quality_event", { p_event_id: id, p_note: note || null })
      : await supabase.rpc("acknowledge_organisation_status_flag", { p_flag_id: id, p_note: note || null });

  if (error) {
    await reportError(error, { operation: "admin.review.decide", type, id });
    const { status, error: message } = rpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
