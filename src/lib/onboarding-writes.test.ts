import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  endGuide,
  recordStep,
  type GuideEndColumn,
  type OnboardingDb,
} from "./onboarding-writes.ts";

type InsertCall = { userId: string; stepKey: string };
type UpdateCall = { userId: string; column: GuideEndColumn; at: string };

function fakeDb(
  responses: { insert?: { code?: string } | null; update?: unknown } = {},
): OnboardingDb & { inserts: InsertCall[]; updates: UpdateCall[] } {
  const inserts: InsertCall[] = [];
  const updates: UpdateCall[] = [];
  return {
    inserts,
    updates,
    async insertStep(userId, stepKey) {
      inserts.push({ userId, stepKey });
      return { error: responses.insert ?? null };
    },
    async setGuideEndedAt(userId, column, at) {
      updates.push({ userId, column, at });
      return { error: responses.update ?? null };
    },
  };
}

describe("recordStep", () => {
  it("records a valid step", async () => {
    const db = fakeDb();
    const outcome = await recordStep(db, "user-1", "outreach_preferences");

    assert.deepEqual(outcome, { ok: true, wrote: true });
    assert.deepEqual(db.inserts, [
      { userId: "user-1", stepKey: "outreach_preferences" },
    ]);
  });

  it("refuses an unknown step without touching the database", async () => {
    const db = fakeDb();
    const outcome = await recordStep(db, "user-1", "email_draft");

    assert.deepEqual(outcome, { ok: false, reason: "unknown_step" });
    assert.equal(db.inserts.length, 0);
  });

  it("refuses an empty step key", async () => {
    const db = fakeDb();

    assert.deepEqual(await recordStep(db, "user-1", ""), {
      ok: false,
      reason: "unknown_step",
    });
    assert.equal(db.inserts.length, 0);
  });

  // A double click, or a revisit of the clients page, means the same thing as the
  // first attempt. Surfacing it as a failure would put an error in front of a CAM
  // who did nothing wrong.
  it("treats an already-recorded step as success", async () => {
    const db = fakeDb({ insert: { code: "23505" } });

    assert.deepEqual(await recordStep(db, "user-1", "review_clients"), {
      ok: true,
      wrote: false,
    });
  });

  it("reports a genuine write failure rather than claiming the step is done", async () => {
    const db = fakeDb({ insert: { code: "42501" } });
    const outcome = await recordStep(db, "user-1", "review_clients");

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "write_failed");
    assert.deepEqual(outcome.ok === false && outcome.error, { code: "42501" });
  });

  it("writes progress against the id it was given and no other", async () => {
    const db = fakeDb();
    await recordStep(db, "user-1", "outreach_preferences");

    assert.equal(db.inserts[0].userId, "user-1");
  });
});

describe("endGuide", () => {
  it("stamps the dismissal column", async () => {
    const db = fakeDb();
    const outcome = await endGuide(
      db,
      "user-1",
      "onboarding_dismissed_at",
      () => "2026-08-09T12:00:00.000Z",
    );

    assert.deepEqual(outcome, { ok: true, wrote: true });
    assert.deepEqual(db.updates, [
      {
        userId: "user-1",
        column: "onboarding_dismissed_at",
        at: "2026-08-09T12:00:00.000Z",
      },
    ]);
  });

  it("stamps the completion column", async () => {
    const db = fakeDb();
    await endGuide(db, "user-1", "onboarding_completed_at", () => "2026-08-09T12:00:00.000Z");

    assert.equal(db.updates[0].column, "onboarding_completed_at");
  });

  it("reports a write failure rather than claiming the guide ended", async () => {
    const db = fakeDb({ update: { message: "denied" } });
    const outcome = await endGuide(db, "user-1", "onboarding_dismissed_at");

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "write_failed");
  });
});
