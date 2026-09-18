import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user's onboarding and feedback-prompt state, read once per
 * request.
 *
 * AppShell reads it for the sidebar's onboarding widget, and the dashboard reads
 * the same row and step list again for the first-run guide and the feedback
 * prompt. Those were three separate trips to the database for one row; `cache()`
 * makes them one. The select is the union of what every caller needs.
 *
 * Keyed on the user id (a string), so every caller shares one entry — see the
 * note on `loadAuthenticatedProfile` in `src/lib/auth/actor.ts` for why an
 * object argument would not.
 */
export const loadViewerState = cache(async (userId: string) => {
  const supabase = await createClient();
  const [profile, steps] = await Promise.all([
    supabase
      .from("users")
      .select(
        "role, invite_accepted_at, onboarding_completed_at, onboarding_dismissed_at, feedback_snoozed_until",
      )
      .eq("id", userId)
      .maybeSingle(),
    // RLS returns this user's own rows only (matrix §3.12), so no filter.
    supabase.from("user_onboarding_steps").select("step_key"),
  ]);
  return { profile, steps };
});
