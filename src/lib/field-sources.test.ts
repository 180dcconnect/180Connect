import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupFieldSources, type FieldSourceRow } from "./field-sources.ts";

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
});
