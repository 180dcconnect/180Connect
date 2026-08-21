import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashPayload } from "./checksum.ts";
import { planRowUpdate, type BackfillRow } from "./backfill.ts";
import type { FieldRule } from "./field-filter.ts";

const denyDob: FieldRule[] = [
  {
    source: "companies_house",
    field_path: "officers[*].date_of_birth",
    action: "deny",
  },
];

function row(overrides: Partial<BackfillRow> = {}): BackfillRow {
  return {
    id: "row-1",
    record_source: "companies_house",
    raw_payload: {
      company_name: "Acme",
      officers: [{ name: "Alice", date_of_birth: "1990-01-01" }],
    },
    rule_version_applied: null,
    ...overrides,
  };
}

describe("planRowUpdate", () => {
  it("strips a denied field from a payload written before the rules existed", () => {
    const update = planRowUpdate(row(), denyDob, 3);

    assert.ok(update);
    assert.deepEqual(update.raw_payload, {
      company_name: "Acme",
      officers: [{ name: "Alice" }],
    });
    assert.deepEqual(update.excluded_fields, ["officers[*].date_of_birth"]);
    assert.equal(update.rule_version_applied, 3);
  });

  it("recomputes the checksum to match the payload it actually stores", () => {
    // A stale checksum would describe a payload that no longer exists, and the
    // next ingestion run compares against it to decide whether anything changed.
    const update = planRowUpdate(row(), denyDob, 3);

    assert.ok(update);
    assert.equal(update.checksum, hashPayload(update.raw_payload));
  });

  it("stamps a clean row without touching its payload or checksum", () => {
    const clean = row({ raw_payload: { company_name: "Acme" } });
    const update = planRowUpdate(clean, denyDob, 3);

    assert.ok(update);
    assert.deepEqual(update.excluded_fields, []);
    assert.equal(update.rule_version_applied, 3);
    // Absent, not null: the update statement must not name these columns at all.
    assert.equal("raw_payload" in update, false);
    assert.equal("checksum" in update, false);
  });

  it("skips a row already checked against this rule version", () => {
    // Re-filtering it can only reach the same answer, and rewriting every row on
    // every pass would make the backfill unusable on a real table.
    const done = row({ rule_version_applied: 3 });

    assert.equal(planRowUpdate(done, denyDob, 3), null);
  });

  it("revisits a row stamped with an older rule version", () => {
    const stale = row({ rule_version_applied: 2 });

    assert.ok(planRowUpdate(stale, denyDob, 3));
  });

  it("leaves a row alone when the deny rule belongs to another source", () => {
    const other = row({ record_source: "charity_commission" });
    const update = planRowUpdate(other, denyDob, 3);

    assert.ok(update);
    assert.deepEqual(update.excluded_fields, []);
    assert.equal("raw_payload" in update, false);
  });

  it("applies a global rule to every source", () => {
    const globalRule: FieldRule[] = [
      { source: null, field_path: "ethnicity", action: "deny" },
    ];
    const withSpecialCategory = row({
      record_source: "charity_commission",
      raw_payload: { name: "Acme", ethnicity: "redacted-me" },
    });

    const update = planRowUpdate(withSpecialCategory, globalRule, 3);

    assert.ok(update);
    assert.deepEqual(update.raw_payload, { name: "Acme" });
    assert.deepEqual(update.excluded_fields, ["ethnicity"]);
  });
});
