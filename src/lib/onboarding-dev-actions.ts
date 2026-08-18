"use server";

import { revalidatePath } from "next/cache";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";

/**
 * Dev/testing helper to reset the active user's onboarding state.
 * Allows repeating the F255 first-run guide flow end-to-end.
 */
export async function resetOnboardingStateAction(): Promise<{ ok: boolean; message?: string }> {
  const authorization = await getCurrentActor(undefined, {
    route: "onboarding.dev_reset",
  });
  if (!authorization.ok) {
    return { ok: false, message: "Unauthorized" };
  }

  const supabase = await createClient();
  const userId = authorization.actor.id;

  // 1. Delete recorded onboarding steps for the current user
  const { error: stepsError } = await supabase
    .from("user_onboarding_steps")
    .delete()
    .eq("user_id", userId);

  if (stepsError) {
    await reportError(stepsError, { operation: "onboarding.dev_reset_steps" });
    // Note: If RLS policy restricts DELETE on user_onboarding_steps, log and continue with users table update
  }

  // 2. Clear terminal onboarding timestamps and ensure invite_accepted_at is non-null
  const { error: userError } = await supabase
    .from("users")
    .update({
      onboarding_completed_at: null,
      onboarding_dismissed_at: null,
      invite_accepted_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (userError) {
    await reportError(userError, { operation: "onboarding.dev_reset_user" });
    return { ok: false, message: userError.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/preview-guide");
  return { ok: true };
}
