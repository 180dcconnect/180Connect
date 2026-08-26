"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { getActiveScoutConfig } from "@/lib/scoring/configured-weights";
import { rescoreAllOrganisations } from "@/lib/scoring/rescore-all";
import {
  readWeightsForm,
  toFractions,
  validateWeightsForm,
  weightsEqual,
  type ScoutWeightKey,
} from "@/lib/scoring/scout-weight-inputs";

export type ScoreSettingsState = {
  status: "idle" | "error" | "success";
  message?: string;
  /**
   * Per-field validation problems, so all five sliders can be corrected in one
   * pass. Keyed by the ScoutWeightKey the panel renders.
   */
  fieldErrors?: Partial<Record<ScoutWeightKey, string>>;
};

/**
 * F096: saves a new set of scoring weights and rescores every client under
 * them.
 *
 * Permission is `platform-settings:manage` (admin-only per ROLE_PERMISSIONS) —
 * the ticket's resolved open question ("who can edit weights") — and it is
 * enforced twice: here for a friendly refusal, and inside the
 * set_scout_weights SECURITY DEFINER RPC for the one that actually holds,
 * since anyone with a session can call the RPC directly through PostgREST.
 *
 * The database write and its audit_log row happen atomically inside the RPC;
 * the recalculation sweep runs after, deliberately outside that transaction:
 * it is best-effort by the rescore contract, and a sweep failure must be
 * visible to the admin without un-doing (or being entangled with) the weight
 * change itself.
 */
export async function saveScoutWeightsAction(
  _previousState: ScoreSettingsState,
  formData: FormData,
): Promise<ScoreSettingsState> {
  const authorization = await getCurrentActor("platform-settings:manage", {
    route: "/admin/score-settings",
  });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const parsed = validateWeightsForm(readWeightsForm(formData));
  if (!parsed.success) {
    const fieldErrors: Partial<Record<ScoutWeightKey, string>> = {};
    for (const [key, messages] of Object.entries(parsed.fieldErrors)) {
      if (messages?.length) fieldErrors[key as ScoutWeightKey] = messages[0];
    }
    return {
      status: "error",
      message: "Fix the highlighted weights before saving.",
      fieldErrors,
    };
  }

  const fractions = toFractions(parsed.data);

  // A no-op save must not trigger a full-book rescore. Compared against what
  // the RPC would read, at display precision, so float noise cannot manufacture
  // work; the RPC re-checks exact equality itself as the authoritative guard.
  const current = await getActiveScoutConfig();
  if (!current.degraded && weightsEqual(current.weights, fractions)) {
    return { status: "success", message: "No changes to save — those are the active weights." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_scout_weights", {
    p_weights: fractions,
  });

  if (error) {
    // Every failure visible and recorded (DoD). The user-facing message never
    // carries raw Postgres text except for the RPC's own deliberate validation
    // sentences, which are written to be readable.
    await reportError(error, { operation: "scout_weights.save", code: error.code ?? null });
    const message =
      error.code === "42501"
        ? "Only an administrator can change scoring weights."
        : error.code === "22023"
          ? error.message
          : "Could not save the new weights. Try again.";
    return { status: "error", message };
  }

  revalidatePath("/admin/score-settings");

  // AC2: the new weights apply to existing clients now, not just future imports.
  const sweep = await rescoreAllOrganisations();
  revalidatePath("/clients");

  if (!sweep.ok && sweep.error) {
    return {
      status: "success",
      message: `New weights saved (version recorded in the audit log). ${sweep.error}`,
    };
  }

  return {
    status: "success",
    message: `New weights saved and ${sweep.scored} client score${sweep.scored === 1 ? "" : "s"} recalculated.`,
  };
}
