import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_KEYS,
  guideProgress,
  isOnboardingStepKey,
  shouldShowGuide,
  type OnboardingUser,
} from "./onboarding.ts";

function newCam(overrides: Partial<OnboardingUser> = {}): OnboardingUser {
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
    assert.equal(shouldShowGuide(newCam()), true);
  });

  it("does not show it once every step is complete (AC5)", () => {
    assert.equal(
      shouldShowGuide(newCam({ onboardingCompletedAt: "2026-08-09T10:00:00Z" })),
      false,
    );
  });

  it("does not show it once dismissed early (AC5)", () => {
    assert.equal(
      shouldShowGuide(newCam({ onboardingDismissedAt: "2026-08-09T10:00:00Z" })),
      false,
    );
  });

  // AC6. An account that predates the invite flow — or the bootstrapped first admin —
  // carries a null invite_accepted_at, which is what keeps the guide off the screens of
  // CAMs who have been using the platform for months.
  it("does not show it to a CAM who never accepted an invite (AC6)", () => {
    assert.equal(shouldShowGuide(newCam({ inviteAcceptedAt: null })), false);
  });

  it("does not show it to admins or viewers", () => {
    assert.equal(shouldShowGuide(newCam({ role: "admin" })), false);
    assert.equal(shouldShowGuide(newCam({ role: "viewer" })), false);
  });

  it("does not show it when there is no profile to read", () => {
    assert.equal(shouldShowGuide(null), false);
  });
});

describe("guideProgress", () => {
  it("reports nothing done for a CAM who has just arrived", () => {
    const progress = guideProgress([]);
    assert.equal(progress.completedCount, 0);
    assert.equal(progress.totalCount, 2);
    assert.equal(progress.allDone, false);
    assert.deepEqual(
      progress.steps.map((step) => step.done),
      [false, false],
    );
  });

  it("marks only the steps that were actually recorded", () => {
    const progress = guideProgress(["outreach_preferences"]);
    assert.equal(progress.completedCount, 1);
    assert.equal(progress.allDone, false);
    assert.deepEqual(
      progress.steps.map((step) => step.done),
      [true, false],
    );
  });

  it("reports allDone once every step is recorded", () => {
    const progress = guideProgress(["review_clients", "outreach_preferences"]);
    assert.equal(progress.completedCount, 2);
    assert.equal(progress.allDone, true);
  });

  // A row for a step that has since been removed from the checklist must not be able
  // to push the count past the number of steps on screen.
  it("ignores keys that are not part of the current checklist", () => {
    const progress = guideProgress(["outreach_preferences", "email_draft"]);
    assert.equal(progress.completedCount, 1);
    assert.equal(progress.totalCount, 2);
    assert.equal(progress.allDone, false);
  });

  it("is not confused by the same step recorded twice", () => {
    const progress = guideProgress(["review_clients", "review_clients"]);
    assert.equal(progress.completedCount, 1);
  });
});

describe("step definitions", () => {
  it("keeps the rendered steps and the database's allowed keys in step", () => {
    assert.deepEqual(
      ONBOARDING_STEPS.map((step) => step.key),
      [...ONBOARDING_STEP_KEYS],
    );
  });

  // AC3: every step has to lead somewhere. A step whose href is empty, or which only
  // describes the screen in text, is the failure mode this criterion exists to prevent.
  it("gives every step a link target and a call to action", () => {
    for (const step of ONBOARDING_STEPS) {
      assert.ok(step.href.startsWith("/"), `${step.key} has no route`);
      assert.ok(step.cta.length > 0, `${step.key} has no call to action`);
      assert.ok(step.description.length > 0, `${step.key} has no description`);
    }
  });

  it("does not offer the email-draft step until F100 exists", () => {
    assert.equal(isOnboardingStepKey("email_draft"), false);
  });

  it("accepts the keys the database allows", () => {
    assert.equal(isOnboardingStepKey("outreach_preferences"), true);
    assert.equal(isOnboardingStepKey("review_clients"), true);
  });
});
