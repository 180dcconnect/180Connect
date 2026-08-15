/**
 * F255 — the decision half of the onboarding writes.
 *
 * Same split as `src/lib/supabase/session-guard.ts`: a Server Action cannot be
 * unit-tested (it carries "use server" and imports `next/cache`, which only
 * resolves inside the bundler), so what should happen lives here behind a small
 * structural interface, and `onboarding-actions.ts` is left with the wiring — the
 * real client, the actor lookup, and the cache revalidation.
 *
 * The behaviour worth pinning down is narrow but easy to get wrong: an unknown
 * step key must never reach the database, a repeat of a step already recorded is
 * a success rather than an error, and ending the guide must not overwrite the
 * timestamp of an earlier ending.
 */

import { isOnboardingStepKey } from "./onboarding.ts";

/** Which of the two terminal timestamps on `users` a write is ending the guide with. */
export type GuideEndColumn = "onboarding_completed_at" | "onboarding_dismissed_at";

/** The slice of the Supabase client these writes need — enough to fake in tests. */
export type OnboardingDb = {
  /** Inserts a completed step. Returns `code: "23505"` when it already exists. */
  insertStep(
    userId: string,
    stepKey: string,
  ): Promise<{ error: { code?: string } | null }>;
  /**
   * Sets one of the two terminal timestamps on `users`, but only where it is still
   * null — see `endGuide` for why that condition is part of the contract.
   */
  setGuideEndedAt(
    userId: string,
    column: GuideEndColumn,
    at: string,
  ): Promise<{ error: unknown }>;
};

export type WriteOutcome =
  | { ok: true; wrote: boolean }
  | { ok: false; reason: "unknown_step" | "write_failed"; error?: unknown };

/** Postgres unique_violation. The step was already recorded. */
const UNIQUE_VIOLATION = "23505";

/**
 * Records a completed step.
 *
 * `wrote: false` distinguishes "already done" from "just done" for a caller that
 * cares; both are `ok`, because "mark this done" arriving twice — a double click,
 * a revisit of the clients page — means the same thing both times, and reporting
 * the second as a failure would put an error in front of a CAM who did nothing
 * wrong.
 */
export async function recordStep(
  db: OnboardingDb,
  userId: string,
  stepKey: string,
): Promise<WriteOutcome> {
  // Checked here rather than trusted from the caller. The database has the same
  // constraint, but a key rejected in the application never becomes a failed
  // insert someone has to explain when reading the logs.
  if (!isOnboardingStepKey(stepKey)) {
    return { ok: false, reason: "unknown_step" };
  }

  const { error } = await db.insertStep(userId, stepKey);
  if (!error) return { ok: true, wrote: true };
  if (error.code === UNIQUE_VIOLATION) return { ok: true, wrote: false };
  return { ok: false, reason: "write_failed", error };
}

/**
 * Ends the guide, either because every step is done or because the CAM dismissed
 * it.
 *
 * The `where ... is null` condition lives in `setGuideEndedAt` rather than here,
 * because it is only worth anything inside the same statement as the write. It
 * keeps the first ending's timestamp: the column means "when they finished or
 * closed it", and a second click should not move that.
 */
export async function endGuide(
  db: OnboardingDb,
  userId: string,
  column: GuideEndColumn,
  now: () => string = () => new Date().toISOString(),
): Promise<WriteOutcome> {
  const { error } = await db.setGuideEndedAt(userId, column, now());
  if (error) return { ok: false, reason: "write_failed", error };
  return { ok: true, wrote: true };
}
