import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewingActor, actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { safeValidate } from "@/lib/validation";
import {
  DECIDED_LIMIT,
  ENTITY_MATCH_CANDIDATE_SELECT,
  PENDING_LIMIT,
  duplicateRpcFailure,
  toPendingReview,
  toQueueRecord,
  type EntityMatchCandidateRow,
} from "@/lib/duplicates";
import {
  createDiscrepancyDetectionStore,
  detectAndFlagDiscrepancies,
  type ChoiceOverrides,
  type DiscrepancyField,
} from "@/lib/discrepancies/detect-field-discrepancies";

/**
 * F042 — Deduplicate Clients, admin review queue.
 *
 * GET   list every potential duplicate, most recent first: the pending set with
 *       both records read out for the side-by-side comparison, then the decided
 *       set as history. Rows are written by the ingestion pipeline
 *       (service_role), never by this route.
  * PATCH confirm or dismiss a pending flag — decide_duplicate_flag. Confirming a
  *       match also runs F048's discrepancy detection as a follow-up (see below),
  *       applying the merge dialog's per-field winners (`fieldChoices`) first.
 *
 * Admin-only route (approval:manage — same permission suppressions uses for its
 * admin-only decision queue).
 */

const winnerSchema = z.enum(["existing", "incoming"]);

const decideSchema = z.object({
  entityMatchCandidateId: z.uuid(),
  confirmed: z.boolean(),
  note: z.string().trim().optional(),
  // The merge dialog's per-field winners. Keys must stay identical to
  // DISCREPANCY_FIELDS (same convention as write-organisations.ts's
  // TRACKED_FIELD_SOURCES) — anything else is stripped, never applied.
  fieldChoices: z
    .object({
      legal_name: winnerSchema.optional(),
      website: winnerSchema.optional(),
      contact_email: winnerSchema.optional(),
      address_line_1: winnerSchema.optional(),
      city: winnerSchema.optional(),
      postcode: winnerSchema.optional(),
    })
    .optional(),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET() {
  const authorization = await getViewingActor("approval:manage", {
    route: "/admin/duplicates",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const supabase = await createClient();

  // Bounded like the page's initial load, through the same two constants, so a
  // refresh cannot return a different window than the read it replaces. The
  // panel splits the two client-side, and raw_payload per row makes an
  // unbounded refresh the heaviest refetch on the page.
  const [{ data: pendingData, error: pendingError }, { data: decidedData, error: decidedError }] =
    await Promise.all([
      supabase
        .from("entity_match_candidates")
        .select(ENTITY_MATCH_CANDIDATE_SELECT)
        .eq("match_status", "pending")
        .order("created_at", { ascending: false })
        .limit(PENDING_LIMIT)
        .overrideTypes<EntityMatchCandidateRow[], { merge: false }>(),
      supabase
        .from("entity_match_candidates")
        .select(ENTITY_MATCH_CANDIDATE_SELECT)
        .neq("match_status", "pending")
        .order("created_at", { ascending: false })
        .limit(DECIDED_LIMIT)
        .overrideTypes<EntityMatchCandidateRow[], { merge: false }>(),
    ]);

  const error = pendingError ?? decidedError;
  if (pendingError) {
    await reportError(pendingError, { operation: "admin.duplicates.list_pending" });
  }
  if (decidedError) {
    await reportError(decidedError, { operation: "admin.duplicates.list_decided" });
  }

  if (error) {
    return NextResponse.json(
      { error: "The duplicates list could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  // Read on the server, like the page's own load: the register side of each pair
  // needs the source mappers, and the panel is a client component.
  return NextResponse.json({
    pending: (pendingData ?? []).map(toPendingReview),
    decided: (decidedData ?? []).map(toQueueRecord),
  });
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

  const parsed = safeValidate(decideSchema, input);
  if (!parsed.success) {
    const fieldCount = Object.keys(parsed.fieldErrors).length;
    logSecurityEvent("validation.rejected", {
      route: "/api/admin/duplicates",
      fieldCount,
    });
    const firstMessage = Object.values(parsed.fieldErrors)
      .flatMap((messages) => messages ?? [])
      .find((message) => message.trim() !== "");
    return NextResponse.json(
      { error: firstMessage ?? "Check the decision details." },
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
  //
  // When the merge dialog sent per-field winners, detection leaves those fields
  // pending however the priority rules would have settled them, and each one is
  // then resolved here with the admin's pick — an explicit choice always beats a
  // silent rule. A resolve that fails leaves its conflict in the discrepancies
  // queue (detection already wrote it), so nothing chosen is lost quietly.
  let warning: string | undefined;
  let appliedIncoming = 0;
  let appliedTotal = 0;
  if (parsed.data.confirmed) {
    // Ignored unless confirmed: winners only mean something when one record survives.
    const overrides: ChoiceOverrides = parsed.data.fieldChoices ?? {};
    const chosen = Object.entries(overrides).filter(
      (entry): entry is [DiscrepancyField, "existing" | "incoming"] =>
        entry[1] === "existing" || entry[1] === "incoming",
    );
    try {
      await detectAndFlagDiscrepancies(
        parsed.data.entityMatchCandidateId,
        createDiscrepancyDetectionStore(supabase),
        overrides,
      );
      if (chosen.length > 0) {
        const { data: openRows, error: openError } = await supabase
          .from("field_discrepancies")
          .select("id, field_name")
          .eq("entity_match_candidate_id", parsed.data.entityMatchCandidateId)
          .eq("status", "pending");
        if (openError) throw openError;
        const openByField = new Map((openRows ?? []).map((row) => [row.field_name, row.id]));
        let failed = 0;
        for (const [fieldName, choice] of chosen) {
          // No live conflict for this field (values agreed after all, or the
          // flag failed to write) — nothing to apply.
          const discrepancyId = openByField.get(fieldName);
          if (!discrepancyId) continue;
          appliedTotal += 1;
          const { error: resolveError } = await supabase.rpc("resolve_field_discrepancy", {
            p_field_discrepancy_id: discrepancyId,
            p_choice: choice,
            p_note:
              parsed.data.note || "Picked while confirming the two records were one charity.",
          });
          if (resolveError) {
            await reportError(resolveError, {
              operation: "admin.duplicates.decide.resolve_choice",
              entityMatchCandidateId: parsed.data.entityMatchCandidateId,
              fieldName,
            });
            failed += 1;
            continue;
          }
          if (choice === "incoming") appliedIncoming += 1;
        }
        if (failed > 0) {
          warning =
            "Kept as one record, but some of your picks could not be saved — settle the rest under Data discrepancies.";
        }
      }
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

  return NextResponse.json({
    ok: true,
    appliedIncoming,
    appliedTotal,
    ...(warning ? { warning } : {}),
  });
}
