/**
 * F255 — the first-run guide.
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
 *
 * VIEWER TRACK — leadership (GLT / branch president / VP) is read-only oversight.
 * They never own clients, never set outreach preferences, never get assigned work,
 * and their sidebar hides "My tasks — a checklist of writing would be a lie.
 * Their guide is therefore a different list that teaches the three screens they
 * actually oversee: the pipeline, the inbox, and team performance.
 */

/**
 * The step keys are constrained in the database too — see the check constraint in
 * 20260805100000_create_user_onboarding.sql (expanded in 20261019100000).
 * Adding a step means changing both, and the constraint is deliberately the stricter
 * of the two: a typo here fails the insert rather than recording progress against a
 * step that does not exist.
 */
export const ONBOARDING_STEP_KEYS = [
  "outreach_preferences",
  "review_clients",
  "my_tasks",
  "invite_team",
  "view_clients",
  "view_inbox",
  "view_analytics",
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export type OnboardingStep = {
  key: OnboardingStepKey;
  title: string;
  /** Why the step is worth doing, not just what it is — the guide exists so a new viewer doesn't have to ask. */
  description: string;
  href: string;
  cta: string;
};

/**
 * Every known step, keyed so a role can pick its working set. Changing copy here
 * does not require a migration; adding a key does.
 *
 * Copy signed off on #18 (5 Aug 2026) for the original two; viewer and new steps
 * follow the same voice — what it is, why it matters, in one sentence.
 *
 * - outreach_preferences / review_clients (renamed "Claim your clients") / my_tasks
 *   are the CAM + admin track. Admins are CAMs with extra pages — they do the same
 *   client work — so both roles share this list. "Generate your first email draft"
 *   from the original spec is intentionally left out: we have limited AI budget.
 * - invite_team is the conditional fourth for a small workspace (see onboardingStepsForRole).
 * - view_clients / view_inbox / view_analytics are the viewer (leadership) track.
 */
const STEP_DEFINITIONS: Record<OnboardingStepKey, OnboardingStep> = {
  outreach_preferences: {
    key: "outreach_preferences",
    title: "Set your outreach preferences",
    description:
      "Tell us which locations, sectors and client sizes you want to focus on. Your client queue is built from these, so it's worth a minute now.",
    href: "/settings/outreach-preferences",
    cta: "Open preferences",
  },
  review_clients: {
    key: "review_clients",
    title: "Claim your clients",
    description:
      "Browse the client list and take ownership of the ones you'll work — no one is assigned automatically. This is your working list day to day.",
    href: "/clients",
    cta: "Browse clients",
  },
  my_tasks: {
    key: "my_tasks",
    title: "Open your Tasks",
    description:
      "Your personal queue — work assigned to you, overdue first. This is where you'll spend your day.",
    href: "/actions",
    cta: "View my tasks",
  },
  invite_team: {
    key: "invite_team",
    title: "Invite your team",
    description:
      "You're one of the first here — send invites to the CAMs and leaders who'll share this workspace.",
    href: "/admin/users",
    cta: "Invite members",
  },
  view_clients: {
    key: "view_clients",
    title: "View the client pipeline",
    description:
      "The whole pipeline — every client's stage, owner and score. Your read-only view of the team's book of work.",
    href: "/clients",
    cta: "Browse clients",
  },
  view_inbox: {
    key: "view_inbox",
    title: "Follow the inbox",
    description:
      "See the conversations CAMs are having — drafts, sent mail and replies, threaded by client.",
    href: "/inbox",
    cta: "Open inbox",
  },
  view_analytics: {
    key: "view_analytics",
    title: "Track team performance",
    description:
      "Who owns what, where the pipeline sits, and how the team converts. Your oversight dashboard.",
    href: "/admin/analytics",
    cta: "View team analytics",
  },
};

/**
 * The working checklist a role sees.
 *
 * - cam: outreach_preferences, review_clients (Claim), my_tasks
 * - admin: same as cam, plus invite_team when the workspace is tiny (< 3 active users).
 *   Not every admin has to build the team — the first — admin in a fresh workspace
 *   does, and after the team passes 3 the step disappears rather than lingering as
 *   a 4th tick everyone ignores. guideProgress ignores a key that is no longer in
 *   the active list, so someone who invited when small doesn't regress to 3/4 later.
 * - viewer: view_clients, view_inbox, view_analytics (overview track — the three
 *   screens oversight actually uses, not the admin queue).
 */
export function onboardingStepsForRole(
  role: string,
  opts?: { activeUserCount?: number | null },
): readonly OnboardingStep[] {
  if (role === "viewer") {
    return [
      STEP_DEFINITIONS.view_clients,
      STEP_DEFINITIONS.view_inbox,
      STEP_DEFINITIONS.view_analytics,
    ];
  }

  // cam and admin share the operating track
  const base: OnboardingStep[] = [
    STEP_DEFINITIONS.outreach_preferences,
    STEP_DEFINITIONS.review_clients,
    STEP_DEFINITIONS.my_tasks,
  ];

  if (role === "admin") {
    const n = opts?.activeUserCount ?? null;
    if (n !== null && n < 3) {
      return [...base, STEP_DEFINITIONS.invite_team];
    }
  }

  return base;
}

/**
 * Backwards compat: the original constant was the 2-step CAM list. New code should
 * call onboardingStepsForRole(role, opts) instead. Kept so existing imports keep
 * working and so the step-definition test has something to assert shape against.
 * It now equals the cam track (3 steps) — the viewer track lives in onboardingStepsForRole("viewer").
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = onboardingStepsForRole("cam");

/**
 * Shown instead of the normal step description when the CAM owns nothing yet.
 * Without it the link leads to an empty list with no explanation, which is the
 * opposite of what a first-run guide is for. Viewer never hits this — they own nothing by design.
 */
export const REVIEW_CLIENTS_EMPTY_STATE = {
  description:
    "Nothing is assigned to you yet. Browse the client list and take ownership of a client to start building your pipeline.",
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
 * Every active role that does real work gets the guide. That now includes viewers
 * (leadership) — they arrive with a different 3-step list (pipeline → inbox → analytics)
 * but the same eligibility rule. The only thing that hides it is having finished or
 * dismissed it (AC5). Nothing here treats "finished" and "closed it early" differently;
 * they are two columns so "how many actually completed onboarding" stays answerable.
 */
export function shouldShowGuide(user: OnboardingUser | null): boolean {
  if (!user) return false;
  return (
    (user.role === "cam" || user.role === "admin" || user.role === "viewer") &&
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
 * Which steps a viewer has seen, and how far through the overview track they are.
 * Unknown keys in `completedKeys` are ignored rather than counted. A row for a step
 * that no longer exists — or belongs to another role — must not make the guide claim
 * "3 of 2 complete".
 */
function progressForSteps(
  steps: readonly OnboardingStep[],
  completedKeys: readonly string[],
): OnboardingProgress {
  const done = new Set(completedKeys);
  const withDone = steps.map((step) => ({ ...step, done: done.has(step.key) }));
  const completedCount = withDone.filter((step) => step.done).length;
  return {
    steps: withDone,
    completedCount,
    totalCount: steps.length,
    allDone: steps.length > 0 && completedCount === steps.length,
  };
}

/**
 * Role-aware progress. The only place where admin's conditional invite_team is
 * evaluated, so AppShell and the dashboard must pass the same activeUserCount
 * they used to choose the step list — otherwise counts drift.
 */
export function guideProgressForRole(
  role: string,
  completedKeys: readonly string[],
  opts?: { activeUserCount?: number | null },
): OnboardingProgress {
  const steps = onboardingStepsForRole(role, opts);
  return progressForSteps(steps, completedKeys);
}

/**
 * Backwards-compatible: CAM progress (3 steps). Viewer callers should use
 * guideProgressForRole("viewer", keys). The cam/admin dashboard path now calls
 * the role-aware variant so the invite_team condition is respected.
 */
export function guideProgress(completedKeys: readonly string[]): OnboardingProgress {
  return progressForSteps(onboardingStepsForRole("cam"), completedKeys);
}

/** Narrows an arbitrary string to a step key before it reaches the database. */
export function isOnboardingStepKey(value: string): value is OnboardingStepKey {
  return (ONBOARDING_STEP_KEYS as readonly string[]).includes(value);
}
