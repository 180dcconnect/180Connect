import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatLocation,
  formatOutreachStatus,
  visibleClients,
  type ClientListRow,
} from "./visible-clients.ts";

function org(overrides: Partial<ClientListRow> = {}): ClientListRow {
  return {
    id: "org-1",
    legal_name: "Test Charity",
    organisation_type: "charity",
    city: "Bristol",
    country_code: "GB",
    outreach_status: "not_started",
    ...overrides,
  };
}

describe("formatLocation", () => {
  it("uses the city when present", () => {
    assert.equal(formatLocation({ city: "Bristol", country_code: "GB" }), "Bristol");
  });

  it("falls back to country_code when city is null", () => {
    assert.equal(formatLocation({ city: null, country_code: "FR" }), "FR");
  });

  it("falls back to country_code when city is blank", () => {
    assert.equal(formatLocation({ city: "  ", country_code: "GB" }), "GB");
  });
});

describe("formatOutreachStatus", () => {
  it("turns snake_case into a readable label", () => {
    assert.equal(formatOutreachStatus("not_started"), "Not started");
    assert.equal(formatOutreachStatus("replied"), "Replied");
  });
});

describe("visibleClients", () => {
  it("returns every org regardless of import method when there are no suppressions", () => {
    const organisations = [
      org({ id: "a", legal_name: "API Import" }),
      org({ id: "b", legal_name: "Manual Entry" }),
    ];
    const result = visibleClients(organisations, []);
    assert.deepEqual(result.map((c) => c.id), ["a", "b"]);
  });

  it("hides an actively suppressed charity", () => {
    const organisations = [org({ id: "a" }), org({ id: "b" })];
    const suppressions = [{ organisation_id: "a", status: "active" as const }];
    const result = visibleClients(organisations, suppressions);
    assert.deepEqual(result.map((c) => c.id), ["b"]);
  });

  it("still shows a charity with a pending suppression, flagged", () => {
    const organisations = [org({ id: "a" })];
    const suppressions = [{ organisation_id: "a", status: "pending" as const }];
    const result = visibleClients(organisations, suppressions);
    assert.equal(result.length, 1);
    assert.equal(result[0].suppressionPending, true);
  });

  it("returns an empty list for an empty database", () => {
    assert.deepEqual(visibleClients([], []), []);
  });

  it("attaches location and outreach status labels", () => {
    const organisations = [
      org({ id: "a", city: null, country_code: "GB", outreach_status: "queued" }),
    ];
    const result = visibleClients(organisations, []);
    assert.equal(result[0].location, "GB");
    assert.equal(result[0].outreachStatusLabel, "Queued");
  });
});
