"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { getActiveScoutConfig } from "@/lib/scoring/configured-weights";
import { rescoreNextBatch, type RescoreBatchResult } from "@/lib/scoring/rescore-batch";
import {
  configInputsEqual,
  inputFromStored,
  rpcPayloadFromInput,
  validateScoutConfigInput,
  type SaveScoutConfigResult,
} from "@/lib/scoring/scout-config-inputs";

// No type re-exports here: a "use server" module may only export async
// functions (see src/app/login/actions.ts). Result types live in
// src/lib/scoring/scout-config-inputs.ts and rescore-batch.ts.

const ROUTE = "/settings/score-settings";

/**
 * F096 — saves the whole scoring setup: weights, sector ranking, priority towns
 * with their in/out scores, and per-income-band scores.
 *
 * Admin-only (`platform-settings:manage`), enforced here for a friendly refusal
 * and inside set_scout_config for the one that holds. Saving does not rescore:
 * it returns how many clients there are, and the screen then calls
 * `rescoreScoresBatchAction` repeatedly so the admin watches the progress rather
 * than waiting on one long request that a platform timeout could cut off.
 *
 * Messages are written for an admin who is not a developer (AGENTS.md, "Who will
 * maintain this app").
 */
export async function saveScoutConfigAction(raw: unknown): Promise<SaveScoutConfigResult> {
  const authorization = await getCurrentActor("platform-settings:manage", { route: ROUTE });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const parsed = validateScoutConfigInput(raw);
  if (!parsed.success) return { status: "error", message: parsed.message };

  // A no-op save must not trigger a full rescore.
  const current = await getActiveScoutConfig();
  if (
    !current.degraded &&
    current.rules &&
    configInputsEqual(inputFromStored(current.weights, current.rules), parsed.data)
  ) {
    return { status: "unchanged", message: "Nothing to save — these are already the settings in use." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_scout_config", {
    p_config: rpcPayloadFromInput(parsed.data),
  });

  if (error) {
    await reportError(error, { operation: "scout_config.save", code: error.code ?? null });
    const message =
      error.code === "42501"
        ? "Only an administrator can change score settings."
        : error.code === "22023"
          ? "Those settings could not be saved. Check each one and try again."
          : error.code === "P0002"
            ? "The scoring setup could not be found, so nothing was saved. Trying again will not fix this — ask a developer to check it."
            : error.code === "PGRST202"
              ? "Saving these settings needs a database update that has not been installed here yet. Ask a developer to deploy it."
              : "The settings could not be saved. Try again.";
    return { status: "error", message };
  }

  revalidatePath(ROUTE);

  const { count, error: countError } = await supabase
    .from("organisations")
    .select("id", { count: "exact", head: true });
  if (countError) {
    await reportError(countError, { operation: "scout_config.count_clients" });
  }

  return { status: "saved", total: count ?? 0 };
}

/**
 * Rescores the next batch of clients under the active settings. The screen calls
 * this in a loop after a save (or to finish a rescore that was interrupted),
 * passing back `nextAfterId` each time.
 */
export async function rescoreScoresBatchAction(afterId: string | null): Promise<RescoreBatchResult> {
  const authorization = await getCurrentActor("platform-settings:manage", { route: ROUTE });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const result = await rescoreNextBatch(afterId);
  if (result.ok && result.done) {
    revalidatePath("/clients");
    revalidatePath(ROUTE);
  }
  return result;
}
