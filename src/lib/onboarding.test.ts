import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_KEYS,
  guideProgress,
  guideProgressForRole,
  isOnboardingStepKey,
  onboardingStepsForRole,
  shouldShowGuide,
  type OnboardingUser,
} from "./onboarding.ts";

function newUser(overrides: Partial<OnboardingUser> = {}): OnboardingUser {
  return {
    role: "cam",
    inviteAcceptedAt: "2026-08-09T09:00:00Z",
    onboardingCompletedAt: null,
    onboardingDismissedAt: null,
    ...overrides,
  };
}

describe("shouldShowGuide", () => {
  it("shows the guide to an activated CAM who has neither finished nor dismissed it (AC1)", () => {
    assert.equal(shouldShowGuide(newUser({ role: "cam" })), true);
  });

  it("does not show it once every step is complete (AC5)", () => {
    assert.equal(
      shouldShowGuide(newUser({ onboardingCompletedAt: "2026-08-09T10:00:00Z" })),
      false,
    );
  });

  it("does not show it once dismissed early (AC5)", () => {
    assert.equal(
      shouldShowGuide(newUser({ onboardingDismissedAt: "2026-08-09T10:00:00Z" })),
      false,
    );
  });

  // AC6. An account that predates the invite flow — or the bootstrapped first admin —
  // carries a null invite_accepted_at, which is what keeps the guide off the screens of
  // CAMs who have been using the platform for months.
  it("does not show it to a CAM who never accepted an invite (AC6)", () => {
    assert.equal(shouldShowGuide(newUser({ inviteAcceptedAt: null })), false);
  });

  it("shows the guide to an admin who was invited — admins are CAMs with extra pages", () => {
    assert.equal(shouldShowGuide(newUser({ role: "admin" })), true);
  });

  it("shows the guide to a viewer (leadership) who was invited — oversight track", () => {
    assert.equal(shouldShowGuide(newUser({ role: "viewer" })), true);
  });

  it("does not show it to a viewer who never accepted an invite (AC6)", () => {
    assert.equal(shouldShowGuide(newUser({ role: "viewer", inviteAcceptedAt: null })), false);
  });

  it("does not show it when there is no profile to read", () => {
    assert.equal(shouldShowGuide(null), false);
  });
});

describe("onboardingStepsForRole", () => {
  it("gives CAM the operating track (preferences → claim → tasks)", () => {
    const steps = onboardingStepsForRole("cam");
    assert.deepEqual(
      steps.map((s) => s.key),
      ["outreach_preferences", "review_clients", "my_tasks"],
    );
  });

  it("gives admin the same 3 steps when the workspace is large", () => {
    assert.deepEqual(
      onboardingStepsForRole("admin", { activeUserCount: 10 }).map((s) => s.key),
      ["outreach_preferences", "review_clients", "my_tasks"],
    );
  });

  it("gives admin a 4th invite step when the workspace is tiny (<3 active users)", () => {
    const steps = onboardingStepsForRole("admin", { activeUserCount: 2 });
    assert.deepEqual(
      steps.map((s) => s.key),
      ["outreach_preferences", "review_clients", "my_tasks", "invite_team"],
    );
  });

  it("does not add invite_team when the count is null or 3", () => {
    assert.equal(
      onboardingStepsForRole("admin", { activeUserCount: null }).some((s) => s.key === "invite_team"),
      false,
    );
    assert.equal(
      onboardingStepsForRole("admin", { activeUserCount: 3 }).some((s) => s.key === "invite_team"),
      false,
    );
  });

  it("gives viewer the overview track (pipeline → inbox → analytics)", () => {
    assert.deepEqual(
      onboardingStepsForRole("viewer").map((s) => s.key),
      ["view_clients", "view_inbox", "view_analytics"],
    );
  });
});

describe("guideProgress", () => {
  it("reports nothing done for a CAM who has just arrived", () => {
    const progress = guideProgress([]);
    assert.equal(progress.completedCount, 0);
    assert.equal(progress.totalCount, 3);
    assert.equal(progress.allDone, false);
    assert.deepEqual(
      progress.steps.map((step) => step.done),
      [false, false, false],
    );
  });

  it("marks only the steps that were actually recorded", () => {
    const progress = guideProgress(["outreach_preferences"]);
    assert.equal(progress.completedCount, 1);
    assert.equal(progress.allDone, false);
    assert.deepEqual(
      progress.steps.map((step) => step.done),
      [true, false, false],
    );
  });

  it("reports allDone once every step is recorded", () => {
    const progress = guideProgress(["review_clients", "outreach_preferences", "my_tasks"]);
    assert.equal(progress.completedCount, 3);
    assert.equal(progress.allDone, true);
  });

  // A row for a step that has since been removed from the checklist must not be able
  // to push the count past the number of steps on screen.
  it("ignores keys that are not part of the current checklist", () => {
    const progress = guideProgress(["outreach_preferences", "email_draft"]);
    assert.equal(progress.completedCount, 1);
    assert.equal(progress.totalCount, 3);
    assert.equal(progress.allDone, false);
  });

  it("is not confused by the same step recorded twice", () => {
    const progress = guideProgress(["review_clients", "review_clients"]);
    assert.equal(progress.completedCount, 1);
  });

  it("counts invite_team for a small-team admin and ignores it otherwise", () => {
    const small = guideProgressForRole(
      "admin",
      ["outreach_preferences", "review_clients", "my_tasks", "invite_team"],
      { activeUserCount: 2 },
    );
    assert.equal(small.totalCount, 4);
    assert.equal(small.completedCount, 4);
    assert.equal(small.allDone, true);

    const large = guideProgressForRole(
      "admin",
      ["outreach_preferences", "review_clients", "my_tasks", "invite_team"],
      { activeUserCount: 10 },
    );
    // invite_team not in the active list → ignored
    assert.equal(large.totalCount, 3);
    assert.equal(large.completedCount, 3);
    assert.equal(large.allDone, true);
  });

  it("keeps viewer progress separate from CAM keys", () => {
    const viewerEmpty = guideProgressForRole("viewer", []);
    assert.equal(viewerEmpty.totalCount, 3);
    assert.equal(viewerEmpty.completedCount, 0);

    const viewerMixed = guideProgressForRole("viewer", [
      "view_clients",
      "outreach_preferences",
    ]);
    // CAM key ignored
    assert.equal(viewerMixed.completedCount, 1);
    assert.deepEqual(
      viewerMixed.steps.map((s) => s.done),
      [true, false, false],
    );
  });

  it("reports allDone for viewer when all 3 overview steps are done", () => {
    const progress = guideProgressForRole("viewer", [
      "view_clients",
      "view_inbox",
      "view_analytics",
    ]);
    assert.equal(progress.allDone, true);
  });
});

describe("step definitions", () => {
  it("keeps the rendered CAM steps and the database allowlist compatible", () => {
    // ONBOARDING_STEPS is the cam track; every one of its keys must be allowed by the DB,
    // but the DB also allows viewer and conditional admin keys.
    for (const step of ONBOARDING_STEPS) {
      assert.equal(isOnboardingStepKey(step.key), true);
    }
    assert.deepEqual(
      ONBOARDING_STEPS.map((s) => s.key),
      onboardingStepsForRole("cam").map((s) => s.key),
    );
  });

  // AC3: every step has to lead somewhere. A step whose href is empty, or which only
  // describes the screen in text, is the failure mode this criterion exists to prevent.
  it("gives every step a link target and a call to action", () => {
    for (const key of ONBOARDING_STEP_KEYS) {
      const step = onboardingStepsForRole("cam").find((s) => s.key === key)
        ?? onboardingStepsForRole("viewer").find((s) => s.key === key)
        ?? (key === "invite_team" ? onboardingStepsForRole("admin", { activeUserCount: 2 }).find((s) => s.key === key) : null);
      assert.ok(step, `${key} has no definition`);
      assert.ok(step!.href.startsWith("/"), `${key} has no route`);
      assert.ok(step!.cta.length > 0, `${key} has no call to action`);
      assert.ok(step!.description.length > 0, `${key} has no description`);
    }
  });

  it("does not offer the email-draft step until F100 exists", () => {
    assert.equal(isOnboardingStepKey("email_draft"), false);
  });

  it("accepts every key the database allows", () => {
    for (const key of ONBOARDING_STEP_KEYS) {
      assert.equal(isOnboardingStepKey(key), true);
    }
  });
});
