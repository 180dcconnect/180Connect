import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatOrganisationSources } from "./source-tracking.ts";

describe("formatOrganisationSources", () => {
  it("shows a valid API source with a friendly label", () => {
    const sources = formatOrganisationSources([
      {
        source: "companies_house",
        source_record_id: "12345678",
        source_registry_name: "Companies House",
        first_seen_at: "2026-08-01T10:00:00Z",
      },
    ]);

    assert.equal(sources[0]?.label, "Companies House");
    assert.equal(sources[0]?.source_record_id, "12345678");
  });

  it("ignores invalid metadata rather than breaking the client profile", () => {
    assert.deepEqual(
      formatOrganisationSources([
        { source: "", source_record_id: null, source_registry_name: null, first_seen_at: "bad" },
      ]),
      [],
    );
  });

  it("shows all distinct contributing sources", () => {
    const sources = formatOrganisationSources([
      {
        source: "charitybase",
        source_record_id: "cb-1",
        source_registry_name: null,
        first_seen_at: "2026-08-01T10:00:00Z",
      },
      {
        source: "charity_commission",
        source_record_id: "cc-1",
        source_registry_name: null,
        first_seen_at: "2026-08-02T10:00:00Z",
      },
    ]);

    assert.deepEqual(sources.map((source) => source.label), ["CharityBase", "Charity Commission"]);
  });

  it("collapses duplicate links and preserves the original first-seen metadata", () => {
    const sources = formatOrganisationSources([
      {
        source: "companies_house",
        source_record_id: "new-value",
        source_registry_name: null,
        first_seen_at: "2026-08-05T10:00:00Z",
      },
      {
        source: "companies_house",
        source_record_id: "original-value",
        source_registry_name: null,
        first_seen_at: "2026-08-01T10:00:00Z",
      },
    ]);

    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.source_record_id, "original-value");
    assert.equal(sources[0]?.first_seen_at, "2026-08-01T10:00:00Z");
  });

  it("keeps manual origin alongside a later external match", () => {
    const sources = formatOrganisationSources([
      {
        source: "manual",
        source_record_id: null,
        source_registry_name: null,
        first_seen_at: "2026-08-01T10:00:00Z",
      },
      {
        source: "companies_house",
        source_record_id: "12345678",
        source_registry_name: "Companies House",
        first_seen_at: "2026-08-03T10:00:00Z",
      },
    ]);

    assert.deepEqual(sources.map((source) => source.label), ["Manual Entry", "Companies House"]);
  });
});
