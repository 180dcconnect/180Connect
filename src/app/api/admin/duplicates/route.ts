import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import {
  ENTITY_MATCH_CANDIDATE_SELECT,
  duplicateRpcFailure,
  type EntityMatchCandidateRow,
} from "@/lib/duplicates";
import {
  createDiscrepancyDetectionStore,
  detectAndFlagDiscrepancies,
} from "@/lib/discrepancies/detect-field-discrepancies";

/**
 * F042 — Deduplicate Clients, admin review queue.
 *
 * GET   list every potential duplicate (all statuses), most recent first. Rows are
 *       written by the ingestion pipeline (service_role), never by this route.
 * PATCH confirm or dismiss a pending flag — decide_duplicate_flag. Confirming a
 *       match also runs F048's discrepancy detection as a follow-up (see below).
 *
 * Admin-only route (approval:manage — same permission suppressions uses for its
 * admin-only decision queue).
 */

const decideSchema = z.object({
  entityMatchCandidateId: z.uuid(),
  confirmed: z.boolean(),
  note: z.string().trim().optional(),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/duplicates",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("entity_match_candidates")
    .select(ENTITY_MATCH_CANDIDATE_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<EntityMatchCandidateRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.duplicates.list" });
    return NextResponse.json(
      { error: "The duplicates list could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ duplicates: data ?? [] });
}

export async function PATCH(request: Request) {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/duplicates",
  });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/duplicates",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the decision details." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("decide_duplicate_flag", {
    p_entity_match_candidate_id: parsed.data.entityMatchCandidateId,
    p_confirmed: parsed.data.confirmed,
    p_note: parsed.data.note || null,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.duplicates.decide",
      entityMatchCandidateId: parsed.data.entityMatchCandidateId,
    });
    const { status, error: message } = duplicateRpcFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  // F048: a confirmed match is the only point in the pipeline where two records
  // are asserted to be the same client, so it's where a field-by-field conflict
  // check runs. This is a separate DB round trip from decide_duplicate_flag above,
  // not the same transaction — if it throws, the confirmation the admin just made
  // is not rolled back (worse to block that on a secondary check), but the
  // failure must still be visible, not swallowed. See
  // detect-field-discrepancies.ts's own comment for the full reasoning.
  let warning: string | undefined;
  if (parsed.data.confirmed) {
    try {
      await detectAndFlagDiscrepancies(
        parsed.data.entityMatchCandidateId,
        createDiscrepancyDetectionStore(supabase),
      );
    } catch (detectionError) {
      await reportError(
        detectionError instanceof Error ? detectionError : new Error(String(detectionError)),
        {
          operation: "admin.duplicates.decide.detect_discrepancies",
          entityMatchCandidateId: parsed.data.entityMatchCandidateId,
        },
      );
      warning = "Confirmed, but the conflict check failed — review this client manually.";
    }
  }

  return NextResponse.json({ ok: true, ...(warning ? { warning } : {}) });
}
