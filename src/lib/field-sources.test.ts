import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupFieldSources,
  buildFieldHistoryGroups,
  stageEventsFromAudit,
  type FieldSourceRow,
  type MissionHistoryRow,
} from "./field-sources.ts";
import type { AuditRow } from "./timeline.ts";

function row(overrides: Partial<FieldSourceRow> = {}): FieldSourceRow {
  return {
    field_name: "website",
    value: "https://example.org",
    source: "companies_house",
    raw_source_record_id: "raw-1",
    is_current: true,
    recorded_at: "2026-08-10T10:00:00Z",
    ...overrides,
  };
}

function audit(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "audit-1",
    actor_user_id: "user-1",
    action: "status_changed",
    detail: { from: "not_contacted", to: "initial_outreach_sent" },
    created_at: "2026-08-20T10:00:00Z",
    ...overrides,
  };
}

describe("groupFieldSources", () => {
  it("shows the current source for a field with no conflicts (AC1)", () => {
    const result = groupFieldSources([
      row({ field_name: "legal_name", value: "Oxfam", source: "charity_commission" }),
    ]);

    const legalName = result.find((entry) => entry.fieldName === "legal_name");
    assert.equal(legalName?.current?.value, "Oxfam");
    assert.equal(legalName?.current?.sourceLabel, "Charity Commission");
    assert.deepEqual(legalName?.history, []);
  });

  it("keeps both values and both sources visible for a conflicting field (AC2)", () => {
    const result = groupFieldSources([
      row({
        field_name: "website",
        value: "https://new.example.org",
        source: "companies_house",
        is_current: true,
        recorded_at: "2026-08-15T10:00:00Z",
      }),
      row({
        field_name: "website",
        value: "https://old.example.org",
        source: "charitybase",
        is_current: false,
        recorded_at: "2026-08-01T10:00:00Z",
      }),
    ]);

    const website = result.find((entry) => entry.fieldName === "website");
    assert.equal(website?.current?.value, "https://new.example.org");
    assert.equal(website?.current?.sourceLabel, "Companies House");
    assert.equal(website?.history.length, 1);
    assert.equal(website?.history[0]?.value, "https://old.example.org");
    assert.equal(website?.history[0]?.sourceLabel, "CharityBase");
  });

  it("updates correctly when a newer import overwrites a field (AC3)", () => {
    // Same shape resolve_field_discrepancy/record_field_discrepancy leave behind:
    // exactly one is_current row, the rest superseded.
    const result = groupFieldSources([
      row({
        field_name: "contact_email",
        value: "new@example.org",
        source: "companies_house",
        is_current: true,
        recorded_at: "2026-08-16T09:00:00Z",
      }),
      row({
        field_name: "contact_email",
        value: "old@example.org",
        source: "charity_commission",
        is_current: false,
        recorded_at: "2026-08-01T09:00:00Z",
      }),
    ]);

    const email = result.find((entry) => entry.fieldName === "contact_email");
    assert.equal(email?.current?.source, "companies_house");
    assert.equal(email?.history[0]?.source, "charity_commission");
  });

  it("orders history newest-first", () => {
    const result = groupFieldSources([
      row({ field_name: "city", value: "London", is_current: true, recorded_at: "2026-08-16T00:00:00Z" }),
      row({ field_name: "city", value: "Manchester", is_current: false, recorded_at: "2026-08-01T00:00:00Z" }),
      row({ field_name: "city", value: "Leeds", is_current: false, recorded_at: "2026-08-10T00:00:00Z" }),
    ]);

    const city = result.find((entry) => entry.fieldName === "city");
    assert.deepEqual(city?.history.map((entry) => entry.value), ["Leeds", "Manchester"]);
  });

  it("omits a tracked field nothing has ever populated", () => {
    const result = groupFieldSources([row({ field_name: "legal_name" })]);

    assert.equal(result.some((entry) => entry.fieldName === "postcode"), false);
  });

  it("skips a row with an empty value or missing field name (defensive boundary)", () => {
    const result = groupFieldSources([
      row({ field_name: "", value: "x" }),
      row({ field_name: "legal_name", value: "" }),
    ]);

    assert.deepEqual(result, []);
  });

  it("returns fields in a fixed order, not row-arrival order", () => {
    const result = groupFieldSources([
      row({ field_name: "postcode", value: "SW1A 1AA" }),
      row({ field_name: "legal_name", value: "Oxfam" }),
    ]);

    assert.deepEqual(result.map((entry) => entry.fieldName), ["legal_name", "postcode"]);
  });

  it("falls back to the raw source string when there is no friendly label", () => {
    const result = groupFieldSources([row({ field_name: "legal_name", source: "unmapped_source" })]);

    assert.equal(result[0]?.current?.sourceLabel, "unmapped_source");
  });

  it("carries the recorded-by name on manual rows and drops it on pipeline rows", () => {
    const result = groupFieldSources([
      row({
        field_name: "legal_name",
        value: "Typed by a person",
        source: "manual",
        recorded_by: "user-1",
        recorded_by_name: "Ada Admin",
      }),
      row({ field_name: "city", value: "Leeds" }),
    ]);

    const legalName = result.find((entry) => entry.fieldName === "legal_name");
    assert.equal(legalName?.current?.recordedBy, "Ada Admin");

    const city = result.find((entry) => entry.fieldName === "city");
    assert.equal(city?.current?.recordedBy, null);
  });

  it("reads a gone user as the placeholder, never a raw uuid", () => {
    const result = groupFieldSources([
      row({
        field_name: "legal_name",
        source: "manual",
        recorded_by: "user-gone",
        recorded_by_name: null,
      }),
    ]);

    assert.equal(result[0]?.current?.recordedBy, "A former team member");
  });

  it("attributes organisation_type rows with the Type label (20260922104000 widening)", () => {
    const result = groupFieldSources([
      row({ field_name: "organisation_type", value: "charity", source: "charity_commission" }),
    ]);

    assert.deepEqual(result.map((entry) => entry.fieldName), ["organisation_type"]);
    assert.equal(result[0]?.fieldLabel, "Type");
    assert.equal(result[0]?.current?.value, "charity");
  });
});

describe("buildFieldHistoryGroups", () => {
  it("groups tracked fields under Fields, newest first, live value marked", () => {
    const provenance = groupFieldSources([
      row({ field_name: "city", value: "Leeds", is_current: false, recorded_at: "2026-08-01T00:00:00Z" }),
      row({ field_name: "city", value: "London", is_current: true, recorded_at: "2026-08-10T00:00:00Z" }),
    ]);

    const groups = buildFieldHistoryGroups({ provenance, missionRows: [], stageEvents: [] });

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.key, "fields");
    const city = groups[0]?.items[0];
    assert.equal(city?.lines[0]?.value, "London");
    assert.equal(city?.lines[0]?.isCurrent, true);
    assert.equal(city?.lines[1]?.value, "Leeds");
    assert.equal(city?.lines[1]?.isCurrent, false);
  });

  it("labels mission rows by confidence: hand-written (1) vs enrichment", () => {
    const missionRows: MissionHistoryRow[] = [
      { id: "m2", mission_statement: "Hand-written mission", enriched_at: "2026-08-20T00:00:00Z", confidence_score: 1 },
      { id: "m1", mission_statement: "Enriched mission", enriched_at: "2026-08-10T00:00:00Z", confidence_score: 0.8 },
    ];

    const groups = buildFieldHistoryGroups({ provenance: [], missionRows, stageEvents: [] });

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.key, "mission");
    const lines = groups[0]?.items[0]?.lines ?? [];
    assert.equal(lines[0]?.value, "Hand-written mission");
    assert.equal(lines[0]?.sourceLabel, "Manual entry");
    assert.equal(lines[0]?.isCurrent, true);
    assert.equal(lines[1]?.sourceLabel, "Enrichment");
    assert.equal(lines[1]?.isCurrent, false);
  });

  it("formats stage events with the same status labels the timeline uses", () => {
    const groups = buildFieldHistoryGroups({
      provenance: [],
      missionRows: [],
      stageEvents: [
        { created_at: "2026-08-20T00:00:00Z", from: "not_contacted", to: "initial_outreach_sent", actorName: "Ada" },
        { created_at: "2026-08-15T00:00:00Z", from: null, to: "not_contacted", actorName: null },
      ],
    });

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.key, "stage");
    const lines = groups[0]?.items[0]?.lines;
    assert.equal(lines?.[0]?.value, "Not contacted → Initial outreach sent");
    assert.equal(lines?.[0]?.recordedBy, "Ada");
    assert.equal(lines?.[1]?.value, "— → Not contacted");
    assert.equal(lines?.[0]?.isCurrent, true);
  });

  it("returns nothing when nothing has ever been recorded", () => {
    assert.deepEqual(buildFieldHistoryGroups({ provenance: [], missionRows: [], stageEvents: [] }), []);
  });

  it("drops empty mission statements rather than rendering blank lines", () => {
    const groups = buildFieldHistoryGroups({
      provenance: [],
      missionRows: [
        { id: "m1", mission_statement: null, enriched_at: "2026-08-10T00:00:00Z", confidence_score: 0.8 },
        { id: "m2", mission_statement: "   ", enriched_at: "2026-08-11T00:00:00Z", confidence_score: 0.8 },
      ],
      stageEvents: [],
    });

    assert.deepEqual(groups, []);
  });

  it("caps a long history per item instead of rendering a wall of old values", () => {
    const rows: FieldSourceRow[] = [
      row({ field_name: "postcode", value: "current", is_current: true }),
    ];
    for (let i = 0; i < 12; i += 1) {
      rows.push(
        row({ field_name: "postcode", value: `old-${i}`, is_current: false, recorded_at: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z` }),
      );
    }

    const groups = buildFieldHistoryGroups({ provenance: groupFieldSources(rows), missionRows: [], stageEvents: [] });

    const lines = groups[0]?.items[0]?.lines ?? [];
    assert.equal(lines.length, 6);
    assert.equal(lines[0]?.value, "current");
    assert.equal(lines[lines.length - 1]?.value, "old-7");
  });
});

describe("stageEventsFromAudit", () => {
  it("reads from/to out of status_changed rows and resolves the actor name", () => {
    const events = stageEventsFromAudit(
      [audit()],
      new Map([["user-1", "Ada Admin"]]),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?.from, "not_contacted");
    assert.equal(events[0]?.to, "initial_outreach_sent");
    assert.equal(events[0]?.actorName, "Ada Admin");
  });

  it("ignores other audit actions and a gone actor reads as the placeholder", () => {
    const events = stageEventsFromAudit(
      [audit({ action: "ownership_reassigned" }), audit({ actor_user_id: "user-gone" })],
      new Map(),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?.actorName, "A former team member");
  });

  it("a system-acted row (no actor) has no name rather than a fake one", () => {
    const events = stageEventsFromAudit(
      [audit({ actor_user_id: null })],
      new Map(),
    );

    assert.equal(events[0]?.actorName, null);
  });
});
