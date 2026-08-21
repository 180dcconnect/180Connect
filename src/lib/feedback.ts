/**
 * In-app feedback — eligibility logic.
 *
 * Pure functions (testable without a database or browser), mirroring the shape
 * of src/lib/onboarding.ts. Decides whether a user should see the feedback
 * prompt on their dashboard and how to summarise collected feedback for the
 * admin page.
 *
 * The prompt is periodic, not one-and-done:
 *   • After submitting → snoozed 60 days
 *   • After dismissing → snoozed 30 days
 *   • Admin clicks "Request feedback" → snooze cleared for everyone
 *
 * First appearance requires the user to have been on the platform at least
 * 7 days (a proxy for "they've used it enough to have an opinion").
 */

/** Snooze durations in days. */
export const SNOOZE_AFTER_SUBMIT = 60;
export const SNOOZE_AFTER_DISMISS = 30;

/** Minimum days since invite before the prompt first appears. */
export const MIN_DAYS_BEFORE_PROMPT = 7;

export type FeedbackUser = {
  /** When the invited person first confirmed their account. Null for accounts that were never invited. */
  inviteAcceptedAt: string | null;
  /** When the feedback prompt is snoozed until. Null means eligible (if other conditions met). */
  feedbackSnoozedUntil: string | null;
};

/**
 * Whether the feedback prompt should appear for this user right now.
 *
 * AC:
 * 1. They must have accepted their invite at least MIN_DAYS_BEFORE_PROMPT days ago.
 * 2. Their snooze must have expired (or never been set).
 *
 * Accounts that were never invited (bootstrapped admin, seed rows) have null
 * inviteAcceptedAt and are eligible immediately — they are the project team.
 */
export function shouldPromptFeedback(
  user: FeedbackUser | null,
  now: Date = new Date(),
): boolean {
  if (!user) return false;

  // If invite was accepted, check the 7-day minimum
  if (user.inviteAcceptedAt !== null) {
    const accepted = new Date(user.inviteAcceptedAt);
    const elapsed = now.getTime() - accepted.getTime();
    const daysSince = elapsed / (1000 * 60 * 60 * 24);
    if (daysSince < MIN_DAYS_BEFORE_PROMPT) return false;
  }

  // If snoozed and snooze hasn't expired, don't show
  if (user.feedbackSnoozedUntil !== null) {
    const snoozedUntil = new Date(user.feedbackSnoozedUntil);
    if (snoozedUntil > now) return false;
  }

  return true;
}

/** The rating labels, shared between the prompt component and the admin page. */
export const RATING_LABELS = [
  "Terrible",
  "Bad",
  "Okay",
  "Good",
  "Amazing",
] as const;

/** Average rating rounded to one decimal place. Returns null for empty input. */
export function averageRating(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((a, b) => a + b, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}
