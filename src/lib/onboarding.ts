/**
 * F255 — the new-CAM first-run guide.
 *
 * Everything here is pure: which steps exist, whether a given user should see the
 * guide, and how far through it they are. The writes live in onboarding-actions.ts
 * and the rendering in components/first-run-guide.tsx, so this file can be tested
 * without a database or a browser.
 *
 * Step state is stored, not inferred. "Has this CAM set their preferences" could be
 * derived by checking for an outreach_preferences row, but "has this CAM reviewed
 * their clients" has no equivalent — viewing leaves no trace of its own — and a
 * checklist where one tick is derived and the other recorded is a checklist that
 * behaves differently step to step. Both are recorded in user_onboarding_steps.
 */

/**
 * The step keys are constrained in the database too — see the check constraint in
 * 20260805100000_create_user_onboarding.sql. Adding a step means changing both, and
 * the constraint is deliberately the stricter of the two: a typo here fails the
 * insert rather than recording progress against a step that does not exist.
 */
export const ONBOARDING_STEP_KEYS = ["outreach_preferences", "review_clients"] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export type OnboardingStep = {
  key: OnboardingStepKey;
  title: string;
  /** Why the step is worth doing, not just what it is — the guide exists so a new CAM doesn't have to ask. */
  description: string;
  href: string;
  cta: string;
};

/**
 * Copy signed off on #18 (5 Aug 2026). Wording changes belong on that issue, not
 * inline here, so the guide a CAM sees stays the guide the team agreed to.
 *
 * The third step named in the original spec — "generate your first email draft" —
 * is deliberately absent until F100 (#99) exists. Adding it back is one entry here,
 * one value in the database check constraint, and nothing else.
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    key: "outreach_preferences",
    title: "Set your outreach preferences",
    description:
      "Tell us which locations, sectors and organisation sizes you want to focus on. Your client queue is built from these, so it's worth a minute now.",
    href: "/settings/outreach-preferences",
    cta: "Open preferences",
  },
  {
    key: "review_clients",
    title: "Review your assigned clients",
    description:
      "See the organisations you're responsible for, with their pipeline status. This is your working list day to day.",
    href: "/clients",
    cta: "View my clients",
  },
];

/**
 * Shown instead of the normal step 2 when the CAM owns nothing yet. Without it the
 * link leads to an empty list with no explanation, which is the opposite of what a
 * first-run guide is for.
 */
export const REVIEW_CLIENTS_EMPTY_STATE = {
  description:
    "Nothing is assigned to you yet. Browse the client list and take ownership of an organisation to start building your pipeline.",
  cta: "Browse clients",
} as const;

export type OnboardingUser = {
  role: string;
  /** Set when an invited person first confirms their account (F008). Null for accounts that were never invited. */
  inviteAcceptedAt: string | null;
  onboardingCompletedAt: string | null;
  onboardingDismissedAt: string | null;
};

/**
 * AC1, AC5 and AC6 in one predicate, mirroring the SQL in the migration header.
 *
 * `inviteAcceptedAt` is what keeps the guide away from existing CAMs (AC6): it is
 * written when an invited account is first confirmed, so accounts that predate the
 * invite flow — and the bootstrapped first admin — carry null and are never eligible.
 * It is a stricter test than "have they logged in before", and unlike a login count
 * it cannot drift.
 *
 * Either terminal timestamp being set ends the guide for good (AC5). Nothing here
 * treats them differently; they are two columns rather than one so that "finished it"
 * and "closed it early" stay distinguishable afterwards.
 */
export function shouldShowGuide(user: OnboardingUser | null): boolean {
  if (!user) return false;
  return (
    user.role === "cam" &&
    user.inviteAcceptedAt !== null &&
    user.onboardingCompletedAt === null &&
    user.onboardingDismissedAt === null
  );
}

export type OnboardingProgressStep = OnboardingStep & { done: boolean };

export type OnboardingProgress = {
  steps: OnboardingProgressStep[];
  completedCount: number;
  totalCount: number;
  allDone: boolean;
};

/**
 * Unknown keys in `completedKeys` are ignored rather than counted. A row for a step
 * that no longer exists — the email-draft step, if it were recorded and then pulled —
 * should not make the guide claim "3 of 2 complete".
 */
export function guideProgress(completedKeys: readonly string[]): OnboardingProgress {
  const done = new Set(completedKeys);
  const steps = ONBOARDING_STEPS.map((step) => ({ ...step, done: done.has(step.key) }));
  const completedCount = steps.filter((step) => step.done).length;

  return {
    steps,
    completedCount,
    totalCount: steps.length,
    allDone: completedCount === steps.length,
  };
}

/** Narrows an arbitrary string to a step key before it reaches the database. */
export function isOnboardingStepKey(value: string): value is OnboardingStepKey {
  return (ONBOARDING_STEP_KEYS as readonly string[]).includes(value);
}
