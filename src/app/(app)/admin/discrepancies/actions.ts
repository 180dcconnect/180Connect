"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { safeValidate, uuidField } from "@/lib/validation";
import {
  FIELD_DISCREPANCY_SELECT,
  discrepancyRpcFailure,
  type FieldDiscrepancyRow,
} from "@/lib/discrepancies";

const resolveSchema = z.object({
  fieldDiscrepancyId: uuidField("That disagreement could not be read. Refresh the page and try again."),
  choice: z.enum(["existing", "incoming"], {
    error: "Choose which value should stay on the client record.",
  }),
  note: z.string().trim().max(2_000, "Keep the reason to 2,000 characters or fewer.").optional(),
});

export type ResolveDiscrepancyActionResult =
  | { ok: true; discrepancies: FieldDiscrepancyRow[] | null }
  | { ok: false; error: string };

/**
 * Settles one cross-source disagreement through the audited database function.
 * The write gate is load-bearing: viewers can read this route but cannot make a
 * decision, even if they invoke the action without using the rendered page.
 */
export async function resolveDiscrepancyAction(
  input: unknown,
): Promise<ResolveDiscrepancyActionResult> {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/discrepancies",
  });
  if (!authorization.ok) {
    return { ok: false, error: actorFailureMessage(authorization.reason) };
  }

  const validation = safeValidate(resolveSchema, input);
  if (!validation.success) {
    const firstError =
      Object.values(validation.fieldErrors).flat()[0] ??
      "Check the decision and try again.";
    return { ok: false, error: firstError };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_field_discrepancy", {
    p_field_discrepancy_id: validation.data.fieldDiscrepancyId,
    p_choice: validation.data.choice,
    p_note: validation.data.note || null,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.discrepancies.resolve",
      actorUserId: authorization.actor.id,
      fieldDiscrepancyId: validation.data.fieldDiscrepancyId,
    });
    const { error: message } = discrepancyRpcFailure(error);
    return { ok: false, error: message };
  }

  revalidatePath("/admin/discrepancies");

  const { data, error: refreshError } = await supabase
    .from("field_discrepancies")
    .select(FIELD_DISCREPANCY_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<FieldDiscrepancyRow[], { merge: false }>();

  if (refreshError) {
    await reportError(refreshError, {
      operation: "admin.discrepancies.refresh_after_resolve",
      actorUserId: authorization.actor.id,
      fieldDiscrepancyId: validation.data.fieldDiscrepancyId,
    });
    return { ok: true, discrepancies: null };
  }

  return { ok: true, discrepancies: data ?? [] };
}
