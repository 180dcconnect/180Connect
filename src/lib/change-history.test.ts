import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHANGE_HISTORY_ACTIONS,
  buildChangeHistory,
  type ChangeHistoryRow,
} from "./change-history.ts";
import { UNKNOWN_ACTOR } from "./timeline.ts";

const ADMIN = "admin-1";
const CAM_A = "cam-a";
const CAM_B = "cam-b";
const NAMES = new Map<string, string | null>([
  [ADMIN, "Ada Admin"],
  [CAM_A, "Ada Lovelace"],
  // CAM_B deliberately absent — a deleted account.
]);

function row(overrides: Partial<ChangeHistoryRow> = {}): ChangeHistoryRow {
  return {
    id: "audit-1",
    actor_user_id: ADMIN,
    action: "status_changed",
    detail: { from: "new_lead", to: "contacted" },
    created_at: "2026-08-20T10:00:00Z",
    ...overrides,
  };
}

describe("CHANGE_HISTORY_ACTIONS", () => {
  it("covers every action the feed can render, and nothing it cannot", () => {
    assert.deepEqual([...CHANGE_HISTORY_ACTIONS].sort(), [
      "edit_suggestion_approved",
      "edit_suggestion_rejected",
      "field_discrepancy_auto_resolved",
      "field_discrepancy_resolved",
      "ownership_reassigned",
      "status_changed",
    ]);
  });
});

describe("buildChangeHistory", () => {
  it("sorts newest first regardless of input order", () => {
    const entries = buildChangeHistory(
      [
        row({ id: "older", created_at: "2026-08-01T09:00:00Z" }),
        row({ id: "newer", created_at: "2026-08-02T09:00:00Z" }),
      ],
      NAMES,
    );
    assert.deepEqual(entries.map((e) => e.id), ["newer", "older"]);
  });

  it("drops actions outside the known set rather than guessing a shape", () => {
    const entries = buildChangeHistory(
      [
        row({ action: "invite_accepted", detail: {} }),
        row({ action: "suppression_approved", detail: {} }),
      ],
      NAMES,
    );
    assert.equal(entries.length, 0);
  });

  it("renders status changes with pipeline-status labels", () => {
    const [entry] = buildChangeHistory([row()], NAMES);
    assert.equal(entry.label, "Pipeline status changed");
    assert.equal(entry.from, "New lead");
    assert.equal(entry.to, "Contacted");
    assert.equal(entry.applied, null);
  });

  it("resolves ownership uuids to names, and a release to Unassigned", () => {
    const [reassign, release] = buildChangeHistory(
      [
        row({
          id: "r1",
          action: "ownership_reassigned",
          detail: { from: CAM_A, to: ADMIN, reason: "Handover" },
        }),
        row({
          id: "r2",
          action: "ownership_reassigned",
          detail: { from: ADMIN, to: null },
        }),
      ],
      NAMES,
    );
    assert.equal(reassign.from, "Ada Lovelace");
    assert.equal(reassign.to, "Ada Admin");
    assert.equal(reassign.note, "Handover");
    assert.equal(release.from, "Ada Admin");
    assert.equal(release.to, "Unassigned");
  });

  it("shows an approved suggestion as applied with its transition", () => {
    const [entry] = buildChangeHistory(
      [
        row({
          action: "edit_suggestion_approved",
          detail: {
            field: "legal_name",
            from: "Old Name",
            to: "New Name",
            requested_by: CAM_A,
          },
        }),
      ],
      NAMES,
    );
    assert.equal(entry.applied, true);
    assert.equal(entry.fieldLabel, "Name"); // restrictedFieldLabel's curated label
    assert.equal(entry.from, "Old Name");
    assert.equal(entry.to, "New Name");
    assert.equal(entry.note, null);
  });

  it("marks a rejected suggestion as not applied and carries the reason", () => {
    const [entry] = buildChangeHistory(
      [
        row({
          action: "edit_suggestion_rejected",
          detail: {
            field: "postcode",
            from: "SW1A 1AA",
            to: null,
            reason: "Verified against the register.",
          },
        }),
      ],
      NAMES,
    );
    assert.equal(entry.applied, false);
    assert.equal(entry.fieldLabel, "Postcode");
    assert.equal(entry.to, null); // nothing was written
    assert.equal(entry.note, "Verified against the register.");
  });

  it("normalises the discrepancy resolvers' field_name key into fieldLabel", () => {
    const [auto, manual] = buildChangeHistory(
      [
        row({
          id: "d1",
          action: "field_discrepancy_resolved",
          detail: {
            field_name: "city",
            choice: "incoming",
            value: "Manchester",
            note: "Confirmed by phone.",
          },
        }),
        row({
          id: "d2",
          action: "field_discrepancy_auto_resolved",
          actor_user_id: null,
          created_at: "2026-08-21T10:00:00Z",
          detail: {
            field_name: "website",
            choice: "existing",
            value: "https://example.org",
            existing_source: "charity_commission",
            incoming_source: "companies_house",
          },
        }),
      ],
      NAMES,
    );
    assert.equal(manual.fieldLabel, "Town or city"); // curated label for `city`
    assert.equal(manual.to, "Manchester");
    assert.equal(manual.note, "Confirmed by phone.");
    assert.equal(auto.label, "Discrepancy auto-resolved");
    assert.equal(auto.to, "https://example.org");
    assert.match(auto.note ?? "", /source priority/);
  });

  it("reads an unknown or deleted actor as the shared fallback name", () => {
    const [entry] = buildChangeHistory(
      [row({ actor_user_id: CAM_B })],
      NAMES,
    );
    assert.equal(entry.actorName, UNKNOWN_ACTOR);
  });

  it("returns empty for no rows", () => {
    assert.deepEqual(buildChangeHistory([], NAMES), []);
  });
});
