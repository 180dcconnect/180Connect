"use server";

import { revalidatePath } from "next/cache";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { isOnboardingStepKey } from "@/lib/onboarding";

/**
 * F255 — the three writes behind the first-run guide.
 *
 * All of them go through the ordinary RLS-scoped client rather than a SECURITY
 * DEFINER RPC, and none writes an audit_log row. That is deliberate and is argued in
 * docs/audit-log-pattern.md §1 and matrix §3.12: onboarding progress is a user's own
 * view state, it grants nothing, and no other user's access depends on it. The
 * policies do the enforcing — a caller can only ever write their own row, whatever
 * these functions are asked to do.
 *
 * Each still re-checks the actor, per the Next.js guidance that a Server Action is a
 * public endpoint regardless of which page renders it.
 */

export type OnboardingActionResult = { ok: boolean };

/**
 * Records a completed step. Idempotent: the table has a unique constraint on
 * (user_id, step_key), and a repeat is treated as success rather than an error,
 * because "mark this done" arriving twice — a double click, or a revisit of the
 * clients page — means the same thing both times.
 */
export async function recordOnboardingStepAction(
  stepKey: string,
): Promise<OnboardingActionResult> {
  if (!isOnboardingStepKey(stepKey)) return { ok: false };

  const authorization = await getCurrentActor(undefined, { route: "onboarding.record_step" });
  if (!authorization.ok) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_onboarding_steps")
    .insert({ user_id: authorization.actor.id, step_key: stepKey });

  // 23505 = unique_violation. The step was already recorded, which is the outcome
  // the caller wanted.
  if (error && error.code !== "23505") {
    await reportError(error, { operation: "onboarding.record_step" });
    return { ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * AC5 — dismissing the guide before every step is done. The `is(..., null)` guard
 * keeps the first dismissal's timestamp rather than overwriting it on a second click,
 * so the column keeps meaning "when they closed it".
 */
export async function dismissGuideAction(): Promise<OnboardingActionResult> {
  const authorization = await getCurrentActor(undefined, { route: "onboarding.dismiss" });
  if (!authorization.ok) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ onboarding_dismissed_at: new Date().toISOString() })
    .eq("id", authorization.actor.id)
    .is("onboarding_dismissed_at", null);

  if (error) {
    await reportError(error, { operation: "onboarding.dismiss" });
    return { ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * AC5 — the other way the guide ends. Called when a CAM acknowledges the completion
 * state, not automatically when the last step lands: the guide's last job is to tell
 * them they are set up, and a guide that vanished the moment the final tick landed on
 * some other screen would never get to do it.
 */
export async function finishGuideAction(): Promise<OnboardingActionResult> {
  const authorization = await getCurrentActor(undefined, { route: "onboarding.finish" });
  if (!authorization.ok) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", authorization.actor.id)
    .is("onboarding_completed_at", null);

  if (error) {
    await reportError(error, { operation: "onboarding.finish" });
    return { ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
