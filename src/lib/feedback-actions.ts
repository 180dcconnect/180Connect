"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { SNOOZE_AFTER_SUBMIT, SNOOZE_AFTER_DISMISS } from "@/lib/feedback";

// ─── Submit feedback ─────────────────────────────────────────────────────────

type SubmitResult = { ok: true } | { ok: false; message: string };

/**
 * Inserts a feedback row and snoozes the prompt for 60 days.
 *
 * The insert runs through the user's own session (RLS allows own-row INSERT).
 * The snooze writes through the `snooze_feedback` SECURITY DEFINER RPC
 * because `feedback_snoozed_until` has no direct column grant.
 */
export async function submitFeedback(
  rating: number,
  comment?: string,
  pageContext?: string,
): Promise<SubmitResult> {
  if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return { ok: false, message: "Rating must be an integer from 1 to 5." };
  }

  const actorResult = await getCurrentActor();
  if (!actorResult.ok) {
    return { ok: false, message: "You must be signed in to submit feedback." };
  }

  const supabase = await createClient();

  // 1. Insert the feedback row (RLS: feedback_insert allows own user_id)
  const { error: insertError } = await supabase.from("feedback").insert({
    user_id: actorResult.actor.id,
    rating,
    comment: comment?.trim() || null,
    page_context: pageContext || null,
  });

  if (insertError) {
    await reportError(insertError, { operation: "feedback.submit" });
    return { ok: false, message: "Something went wrong. Please try again." };
  }

  // 2. Snooze the prompt for 60 days
  const { error: snoozeError } = await supabase.rpc("snooze_feedback", {
    p_days: SNOOZE_AFTER_SUBMIT,
  });

  if (snoozeError) {
    // Non-fatal: the feedback was saved, just the snooze failed
    await reportError(snoozeError, { operation: "feedback.snooze_after_submit" });
  }

  return { ok: true };
}

// ─── Dismiss feedback ────────────────────────────────────────────────────────

/**
 * Snoozes the feedback prompt for 30 days (without submitting a rating).
 */
export async function dismissFeedback(): Promise<void> {
  const actorResult = await getCurrentActor();
  if (!actorResult.ok) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("snooze_feedback", {
    p_days: SNOOZE_AFTER_DISMISS,
  });

  if (error) {
    await reportError(error, { operation: "feedback.dismiss" });
  }
}

// ─── Admin: request feedback round ───────────────────────────────────────────

type RequestRoundResult = { ok: true } | { ok: false; message: string };

/**
 * Admin-only: clears feedback_snoozed_until for every active user so the
 * prompt re-appears on their next dashboard visit.
 */
export async function requestFeedbackRound(): Promise<RequestRoundResult> {
  const actorResult = await getCurrentActor("user:manage");
  if (!actorResult.ok) {
    return { ok: false, message: "Only administrators can request a feedback round." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_feedback_round");

  if (error) {
    await reportError(error, { operation: "feedback.request_round" });
    return { ok: false, message: "Something went wrong. Please try again." };
  }

  return { ok: true };
}
