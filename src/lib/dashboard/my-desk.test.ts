import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MyAction } from "../actions.ts";
import { summariseMyDesk, type DeskDraft } from "./my-desk.ts";

// Midday, so a local-time day key is the same calendar day in any timezone the
// test runner is likely to sit in.
const NOW = new Date(2026, 8, 15, 12, 0, 0);

function action(overrides: Partial<MyAction> = {}): MyAction {
  return {
    id: "a1",
    title: "Call the director",
    description: null,
    organisationId: "org-1",
    organisationName: "Oxford Homeless Project",
    dueDate: "2026-09-16",
    isOverdue: false,
    origin: "self",
    assignedByName: null,
    ...overrides,
  };
}

function draft(overrides: Partial<DeskDraft> = {}): DeskDraft {
  return {
    id: "d1",
    organisationId: "org-1",
    organisationName: "Oxford Homeless Project",
    subject: "Working together",
    updatedAt: "2026-09-14T10:00:00Z",
    ...overrides,
  };
}

describe("summariseMyDesk", () => {
  it("splits overdue, due this week, later and undated", () => {
    const desk = summariseMyDesk(
      [
        action({ id: "over", dueDate: "2026-09-10", isOverdue: true }),
        action({ id: "today", dueDate: "2026-09-15" }),
        action({ id: "week", dueDate: "2026-09-22" }),
        action({ id: "later", dueDate: "2026-09-23" }),
        action({ id: "undated", dueDate: null }),
      ],
      [],
      NOW,
    );
    assert.deepEqual(desk.overdue.map((a) => a.id), ["over"]);
    assert.deepEqual(desk.dueSoon.map((a) => a.id), ["today", "week"]);
    assert.equal(desk.laterCount, 1);
    assert.equal(desk.undatedCount, 1);
  });

  it("lists the most recently edited draft first", () => {
    const desk = summariseMyDesk(
      [],
      [draft({ id: "old", updatedAt: "2026-09-01T00:00:00Z" }), draft({ id: "new" })],
      NOW,
    );
    assert.deepEqual(desk.drafts.map((d) => d.id), ["new", "old"]);
  });

  it("is empty when there is nothing on the desk", () => {
    const desk = summariseMyDesk([], [], NOW);
    assert.equal(desk.overdue.length + desk.dueSoon.length + desk.drafts.length, 0);
  });
});
