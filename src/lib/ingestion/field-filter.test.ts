import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterPayload,
  resolveRulesForSource,
  type FieldRule,
} from "./field-filter.ts";

// ---------------------------------------------------------------------------
// resolveRulesForSource
// ---------------------------------------------------------------------------

describe("resolveRulesForSource", () => {
  it("returns global rules when no source-specific rules exist", () => {
    const rules: FieldRule[] = [
      { source: null, field_path: "health_data", action: "deny" },
    ];
    const resolved = resolveRulesForSource(rules, "companies_house");
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].field_path, "health_data");
  });

  it("source-specific rule overrides global for the same field_path", () => {
    const rules: FieldRule[] = [
      { source: null, field_path: "officers[*].nationality", action: "deny" },
      {
        source: "companies_house",
        field_path: "officers[*].nationality",
        action: "allow",
      },
    ];
    const resolved = resolveRulesForSource(rules, "companies_house");
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].action, "allow");
  });

  it("ignores rules for a different source", () => {
    const rules: FieldRule[] = [
      {
        source: "charitybase",
        field_path: "trustees[*].home_address",
        action: "deny",
      },
    ];
    const resolved = resolveRulesForSource(rules, "companies_house");
    assert.equal(resolved.length, 0);
  });

  it("merges global and source-specific rules for different paths", () => {
    const rules: FieldRule[] = [
      { source: null, field_path: "health_data", action: "deny" },
      {
        source: "companies_house",
        field_path: "officers[*].date_of_birth",
        action: "deny",
      },
    ];
    const resolved = resolveRulesForSource(rules, "companies_house");
    assert.equal(resolved.length, 2);
  });
});

// ---------------------------------------------------------------------------
// filterPayload — top-level fields
// ---------------------------------------------------------------------------

describe("filterPayload — top-level fields", () => {
  it("strips a denied top-level field", () => {
    const payload = { company_name: "Acme", health_data: "sensitive" };
    const rules: FieldRule[] = [
      { source: null, field_path: "health_data", action: "deny" },
    ];

    const result = filterPayload(payload, rules, "companies_house");

    assert.deepEqual(result.filtered, { company_name: "Acme" });
    assert.deepEqual(result.excludedFields, ["health_data"]);
  });

  it("does nothing when no rules match", () => {
    const payload = { company_name: "Acme", status: "active" };
    const rules: FieldRule[] = [
      { source: null, field_path: "health_data", action: "deny" },
    ];

    const result = filterPayload(payload, rules, "companies_house");

    assert.deepEqual(result.filtered, payload);
    assert.deepEqual(result.excludedFields, []);
  });

  it("returns empty excludedFields when there are no deny rules", () => {
    const payload = { company_name: "Acme" };
    const result = filterPayload(payload, [], "companies_house");

    assert.deepEqual(result.filtered, payload);
    assert.deepEqual(result.excludedFields, []);
  });

  it("handles null payload gracefully", () => {
    const result = filterPayload(null, [
      { source: null, field_path: "x", action: "deny" },
    ], "companies_house");

    assert.equal(result.filtered, null);
    assert.deepEqual(result.excludedFields, []);
  });

  it("handles primitive payload gracefully", () => {
    const result = filterPayload("just a string", [
      { source: null, field_path: "x", action: "deny" },
    ], "companies_house");

    assert.equal(result.filtered, "just a string");
    assert.deepEqual(result.excludedFields, []);
  });
});

// ---------------------------------------------------------------------------
// filterPayload — nested dot-separated paths
// ---------------------------------------------------------------------------

describe("filterPayload — nested paths", () => {
  it("strips a nested field two levels deep", () => {
    const payload = {
      registered_office_address: {
        locality: "Sheffield",
        postal_code: "S1 2AB",
        secret: "hidden",
      },
    };
    const rules: FieldRule[] = [
      {
        source: null,
        field_path: "registered_office_address.secret",
        action: "deny",
      },
    ];

    const result = filterPayload(payload, rules, "companies_house");

    assert.deepEqual(result.filtered, {
      registered_office_address: {
        locality: "Sheffield",
        postal_code: "S1 2AB",
      },
    });
    assert.deepEqual(result.excludedFields, [
      "registered_office_address.secret",
    ]);
  });

  it("does not remove parent when nested path does not exist", () => {
    const payload = { registered_office_address: { locality: "Sheffield" } };
    const rules: FieldRule[] = [
      {
        source: null,
        field_path: "registered_office_address.secret",
        action: "deny",
      },
    ];

    const result = filterPayload(payload, rules, "companies_house");

    assert.deepEqual(result.filtered, payload);
    assert.deepEqual(result.excludedFields, []);
  });
});

// ---------------------------------------------------------------------------
// filterPayload — array wildcards
// ---------------------------------------------------------------------------

describe("filterPayload — array wildcards [*]", () => {
  it("strips a field from every element of an array", () => {
    const payload = {
      officers: [
        { name: "Alice", usual_residential_address: { line1: "123 St" } },
        { name: "Bob", usual_residential_address: { line1: "456 Ave" } },
      ],
    };
    const rules: FieldRule[] = [
      {
        source: "companies_house",
        field_path: "officers[*].usual_residential_address",
        action: "deny",
      },
    ];

    const result = filterPayload(payload, rules, "companies_house");

    assert.deepEqual(result.filtered, {
      officers: [{ name: "Alice" }, { name: "Bob" }],
    });
    assert.deepEqual(result.excludedFields, [
      "officers[*].usual_residential_address",
    ]);
  });

  it("handles array elements where the field does not exist", () => {
    const payload = {
      officers: [
        { name: "Alice", usual_residential_address: { line1: "123 St" } },
        { name: "Bob" }, // no address
      ],
    };
    const rules: FieldRule[] = [
      {
        source: "companies_house",
        field_path: "officers[*].usual_residential_address",
        action: "deny",
      },
    ];

    const result = filterPayload(payload, rules, "companies_house");

    assert.deepEqual(result.filtered, {
      officers: [{ name: "Alice" }, { name: "Bob" }],
    });
    // Still counts as excluded because at least one element had it
    assert.deepEqual(result.excludedFields, [
      "officers[*].usual_residential_address",
    ]);
  });

  it("handles non-array value at the wildcard key gracefully", () => {
    const payload = { officers: "not an array" };
    const rules: FieldRule[] = [
      {
        source: "companies_house",
        field_path: "officers[*].date_of_birth",
        action: "deny",
      },
    ];

    const result = filterPayload(payload, rules, "companies_house");

    assert.deepEqual(result.filtered, payload);
    assert.deepEqual(result.excludedFields, []);
  });

  it("handles missing wildcard key gracefully", () => {
    const payload = { company_name: "Acme" };
    const rules: FieldRule[] = [
      {
        source: "companies_house",
        field_path: "officers[*].date_of_birth",
        action: "deny",
      },
    ];

    const result = filterPayload(payload, rules, "companies_house");

    assert.deepEqual(result.filtered, payload);
    assert.deepEqual(result.excludedFields, []);
  });
});

// ---------------------------------------------------------------------------
// filterPayload — source-specific allow overrides global deny
// ---------------------------------------------------------------------------

describe("filterPayload — allow overrides deny", () => {
  it("a source-specific allow prevents a global deny from stripping the field", () => {
    const payload = { officers: [{ nationality: "British" }] };
    const rules: FieldRule[] = [
      { source: null, field_path: "officers[*].nationality", action: "deny" },
      {
        source: "companies_house",
        field_path: "officers[*].nationality",
        action: "allow",
      },
    ];

    const result = filterPayload(payload, rules, "companies_house");

    assert.deepEqual(result.filtered, payload);
    assert.deepEqual(result.excludedFields, []);
  });

  it("a global deny still applies when no source-specific override exists", () => {
    const payload = { officers: [{ nationality: "British" }] };
    const rules: FieldRule[] = [
      { source: null, field_path: "officers[*].nationality", action: "deny" },
      {
        source: "companies_house",
        field_path: "officers[*].nationality",
        action: "allow",
      },
    ];

    // Different source — the CH allow doesn't apply here
    const result = filterPayload(payload, rules, "charitybase");

    assert.deepEqual(result.filtered, {
      officers: [{}],
    });
    assert.deepEqual(result.excludedFields, ["officers[*].nationality"]);
  });
});

// ---------------------------------------------------------------------------
// filterPayload — multiple deny rules
// ---------------------------------------------------------------------------

describe("filterPayload — multiple rules", () => {
  it("strips multiple fields in one pass", () => {
    const payload = {
      company_name: "Acme",
      officers: [
        {
          name: "Alice",
          date_of_birth: "1990-01-01",
          usual_residential_address: { line1: "123 St" },
          nationality: "British",
        },
      ],
      health_data: "sensitive",
    };
    const rules: FieldRule[] = [
      {
        source: "companies_house",
        field_path: "officers[*].usual_residential_address",
        action: "deny",
      },
      {
        source: "companies_house",
        field_path: "officers[*].date_of_birth",
        action: "deny",
      },
      {
        source: "companies_house",
        field_path: "officers[*].nationality",
        action: "deny",
      },
      { source: null, field_path: "health_data", action: "deny" },
    ];

    const result = filterPayload(payload, rules, "companies_house");

    assert.deepEqual(result.filtered, {
      company_name: "Acme",
      officers: [{ name: "Alice" }],
    });
    assert.equal(result.excludedFields.length, 4);
    assert.ok(result.excludedFields.includes(
      "officers[*].usual_residential_address",
    ));
    assert.ok(result.excludedFields.includes("officers[*].date_of_birth"));
    assert.ok(result.excludedFields.includes("officers[*].nationality"));
    assert.ok(result.excludedFields.includes("health_data"));
  });
});
