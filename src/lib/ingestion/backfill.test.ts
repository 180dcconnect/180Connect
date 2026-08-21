import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashPayload } from "./checksum.ts";
import { planRowUpdate, type BackfillRow } from "./backfill.ts";
import type { DataHandlingPolicy } from "./apply-data-handling.ts";
import type { FieldRule } from "./field-filter.ts";
import type { RedactionRule } from "./personal-data.ts";

/** A policy carrying only the rules a test cares about, at version 3. */
function policy(
  fieldRules: FieldRule[] = [],
  redactionRules: RedactionRule[] = [],
  version = 3,
): DataHandlingPolicy {
  return {
    fieldRules,
    redactionRules,
    roleLocalParts: new Set(["info", "fundraising"]),
    version,
  };
}

const denyDob = policy([
  {
    source: "companies_house",
    field_path: "officers[*].date_of_birth",
    action: "deny",
  },
]);

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
    const update = planRowUpdate(row(), denyDob);

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
    const update = planRowUpdate(row(), denyDob);

    assert.ok(update);
    assert.equal(update.checksum, hashPayload(update.raw_payload));
  });

  it("stamps a clean row without touching its payload or checksum", () => {
    const clean = row({ raw_payload: { company_name: "Acme" } });
    const update = planRowUpdate(clean, denyDob);

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

    assert.equal(planRowUpdate(done, denyDob), null);
  });

  it("revisits a row stamped with an older rule version", () => {
    const stale = row({ rule_version_applied: 2 });

    assert.ok(planRowUpdate(stale, denyDob));
  });

  it("leaves a row alone when the deny rule belongs to another source", () => {
    const other = row({ record_source: "charity_commission" });
    const update = planRowUpdate(other, denyDob);

    assert.ok(update);
    assert.deepEqual(update.excluded_fields, []);
    assert.equal("raw_payload" in update, false);
  });

  it("applies a global rule to every source", () => {
    const globalRule = policy([
      { source: null, field_path: "ethnicity", action: "deny" },
    ]);
    const withSpecialCategory = row({
      record_source: "charity_commission",
      raw_payload: { name: "Acme", ethnicity: "redacted-me" },
    });

    const update = planRowUpdate(withSpecialCategory, globalRule);

    assert.ok(update);
    assert.deepEqual(update.raw_payload, { name: "Acme" });
    assert.deepEqual(update.excluded_fields, ["ethnicity"]);
  });
});

// ---------------------------------------------------------------------------
// F247 AC2 — removing personal data stored before the rule existed
// ---------------------------------------------------------------------------

const redactEmails = policy(
  [],
  [{ source: null, field_path: "*", kind: "redact_personal_email" }],
);

describe("planRowUpdate — personal data already stored (F247 AC2)", () => {
  it("redacts a personal address out of a payload written years ago", () => {
    const stored = row({
      record_source: "charity_commission",
      raw_payload: {
        charity_name: "Acme Trust",
        contact_info: { email: "jane.smith@acmetrust.org" },
      },
      rule_version_applied: null,
    });

    const update = planRowUpdate(stored, redactEmails);

    assert.ok(update);
    assert.deepEqual(update.raw_payload, {
      charity_name: "Acme Trust",
      contact_info: { email: "[redacted:personal-email]" },
    });
    assert.deepEqual(update.excluded_fields, ["*#redact_personal_email"]);
    assert.equal(update.checksum, hashPayload(update.raw_payload));
  });

  it("keeps the organisational address the platform exists to collect", () => {
    const stored = row({
      record_source: "charity_commission",
      raw_payload: { contact_info: { email: "fundraising@acmetrust.org" } },
    });

    const update = planRowUpdate(stored, redactEmails);

    assert.ok(update);
    assert.deepEqual(update.excluded_fields, []);
    assert.equal("raw_payload" in update, false);
  });

  it("is idempotent — a second pass over a redacted row finds nothing", () => {
    // The placeholder is not an email address, so re-running after a further rule
    // change cannot double-redact or churn the checksum. Without this the backfill
    // rewrites every previously-redacted row on every subsequent version bump.
    const alreadyDone = row({
      record_source: "charity_commission",
      raw_payload: { contact_info: { email: "[redacted:personal-email]" } },
    });

    const update = planRowUpdate(alreadyDone, redactEmails);

    assert.ok(update);
    assert.deepEqual(update.excluded_fields, []);
    assert.equal("raw_payload" in update, false);
  });

  it("removes a field and redacts what survives in one pass", () => {
    const both = policy(
      [
        {
          source: "companies_house",
          field_path: "officers[*].name",
          action: "deny",
        },
      ],
      [{ source: null, field_path: "*", kind: "redact_personal_email" }],
    );
    const stored = row({
      raw_payload: {
        company_name: "Acme",
        officers: [{ name: "Alice", email: "alice@acme.org" }],
      },
    });

    const update = planRowUpdate(stored, both);

    assert.ok(update);
    assert.deepEqual(update.raw_payload, {
      company_name: "Acme",
      officers: [{ email: "[redacted:personal-email]" }],
    });
    assert.deepEqual(update.excluded_fields, [
      "officers[*].name",
      "*#redact_personal_email",
    ]);
  });
});
