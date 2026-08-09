"use server";

import { revalidatePath } from "next/cache";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { endGuide, recordStep, type OnboardingDb } from "@/lib/onboarding-writes";

/**
 * F255 — the three writes behind the first-run guide.
 *
 * All of them go through the ordinary RLS-scoped client rather than a SECURITY
 * DEFINER RPC, and none writes an audit_log row. That is deliberate and is argued
 * in docs/audit-log-pattern.md §1 and matrix §3.12: onboarding progress is a
 * user's own view state, it grants nothing, and no other user's access depends on
 * it. The policies do the enforcing — a caller can only ever write their own row,
 * whatever these functions are asked to do, and supabase/tests/rls_policies.test.sql
 * (`suite_onboarding`) holds that to account.
 *
 * Each still re-checks the actor, per the Next.js guidance that a Server Action is
 * a public endpoint regardless of which page renders it.
 *
 * What each write *decides* lives in onboarding-writes.ts, which is unit-tested;
 * this file is the wiring.
 */

export type OnboardingActionResult = { ok: boolean };

async function onboardingDb(): Promise<OnboardingDb> {
  const supabase = await createClient();
  return {
    async insertStep(userId, stepKey) {
      const { error } = await supabase
        .from("user_onboarding_steps")
        .insert({ user_id: userId, step_key: stepKey });
      return { error };
    },
    async setGuideEndedAt(userId, column, at) {
      const { error } = await supabase
        .from("users")
        .update({ [column]: at })
        .eq("id", userId)
        // Same statement, not a read-then-write: two clicks in flight at once must
        // not produce two different answers to "when did they end it".
        .is(column, null);
      return { error };
    },
  };
}

/** Records a completed step. Idempotent — see `recordStep`. */
export async function recordOnboardingStepAction(
  stepKey: string,
): Promise<OnboardingActionResult> {
  const authorization = await getCurrentActor(undefined, {
    route: "onboarding.record_step",
  });
  if (!authorization.ok) return { ok: false };

  const outcome = await recordStep(
    await onboardingDb(),
    authorization.actor.id,
    stepKey,
  );

  if (!outcome.ok) {
    if (outcome.reason === "write_failed") {
      await reportError(outcome.error, { operation: "onboarding.record_step" });
    }
    return { ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

/** AC5 — dismissing the guide before every step is done. */
export async function dismissGuideAction(): Promise<OnboardingActionResult> {
  return endGuideAction("onboarding_dismissed_at", "onboarding.dismiss");
}

/**
 * AC5 — the other way the guide ends. Called when a CAM acknowledges the
 * completion state, not automatically when the last step lands: the guide's last
 * job is to tell them they are set up, and a guide that vanished the moment the
 * final tick landed on some other screen would never get to do it.
 */
export async function finishGuideAction(): Promise<OnboardingActionResult> {
  return endGuideAction("onboarding_completed_at", "onboarding.finish");
}

async function endGuideAction(
  column: "onboarding_completed_at" | "onboarding_dismissed_at",
  route: string,
): Promise<OnboardingActionResult> {
  const authorization = await getCurrentActor(undefined, { route });
  if (!authorization.ok) return { ok: false };

  const outcome = await endGuide(await onboardingDb(), authorization.actor.id, column);

  if (!outcome.ok) {
    await reportError(outcome.error, { operation: route });
    return { ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
