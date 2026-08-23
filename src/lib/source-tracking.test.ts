import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatImportOrigin, formatOrganisationSources } from "./source-tracking.ts";

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

  it("preserves the CAM identified on a manual source", () => {
    const sources = formatOrganisationSources([{
      source: "manual",
      source_record_id: "manual-1",
      source_registry_name: null,
      first_seen_at: "2026-08-01T10:00:00Z",
      source_actor_user_id: "cam-1",
      source_actor_name: "Alex CAM",
    }]);

    assert.equal(sources[0]?.label, "Manual Entry");
    assert.equal(sources[0]?.source_actor_name, "Alex CAM");
  });
});

describe("formatImportOrigin", () => {
  it("returns null when the organisation was never built from a URL import", () => {
    assert.equal(formatImportOrigin(null), null);
    assert.equal(
      formatImportOrigin({ source_url: null, imported_field_paths: [], imported_at: null }),
      null,
    );
  });

  it("labels imported field paths with their profile field names", () => {
    const origin = formatImportOrigin({
      source_url: "https://example.org/about",
      imported_field_paths: ["legal_name", "mission_statement", "website"],
      imported_at: "2026-08-01T10:00:00Z",
    });

    assert.deepEqual(origin?.fieldLabels, ["Name", "Mission", "Website"]);
    assert.equal(origin?.sourceUrl, "https://example.org/about");
  });

  it("falls back to the raw path for an unmapped field", () => {
    const origin = formatImportOrigin({
      source_url: "https://example.org",
      imported_field_paths: ["some_future_column"],
      imported_at: "2026-08-01T10:00:00Z",
    });

    assert.deepEqual(origin?.fieldLabels, ["some_future_column"]);
  });

  it("keeps provenance when imported_at is missing or unparseable", () => {
    // Nothing renders the timestamp yet, so a bad one must not throw away the
    // source URL and field list a CAM does read.
    for (const imported_at of [null, "not-a-date"]) {
      const origin = formatImportOrigin({
        source_url: "https://example.org",
        imported_field_paths: ["legal_name"],
        imported_at,
      });

      assert.equal(origin?.sourceUrl, "https://example.org");
      assert.deepEqual(origin?.fieldLabels, ["Name"]);
      assert.equal(origin?.importedAt, imported_at);
    }
  });

  it("ignores malformed provenance rather than breaking the client profile", () => {
    assert.equal(
      formatImportOrigin({
        source_url: "  ",
        imported_field_paths: ["legal_name"],
        imported_at: "2026-08-01T10:00:00Z",
      }),
      null,
    );
    assert.equal(
      formatImportOrigin({
        source_url: "https://example.org",
        imported_field_paths: "not-an-array",
        imported_at: "2026-08-01T10:00:00Z",
      })?.fieldLabels.length,
      0,
    );
  });
});
