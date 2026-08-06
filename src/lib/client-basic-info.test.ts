import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyEnrichmentChange,
  applyOrganisationChange,
  buildBasicInfo,
  type BasicInfoState,
  type OrganisationDetailRow,
} from "./client-basic-info.ts";

function org(overrides: Partial<OrganisationDetailRow> = {}): OrganisationDetailRow {
  return {
    id: "org-1",
    legal_name: "Test Charity",
    organisation_type: "charity",
    website: "https://example.org",
    contact_email: "hello@example.org",
    address_line_1: "12 High Street",
    city: "Bristol",
    postcode: "BS1 1AA",
    country_code: "GB",
    outreach_status: "not_started",
    ...overrides,
  };
}

function state(overrides: Partial<BasicInfoState> = {}): BasicInfoState {
  return {
    organisation: org(),
    missionStatement: "Helping people thrive.",
    missionEnrichedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildBasicInfo", () => {
  it("shows every field together for a fully populated client", () => {
    const info = buildBasicInfo(state());
    assert.deepEqual(info, {
      name: "Test Charity",
      type: "charity",
      mission: "Helping people thrive.",
      email: "hello@example.org",
      address: "12 High Street, BS1 1AA",
      location: "Bristol",
      website: "https://example.org",
      status: "Not started",
    });
  });

  it("shows an explicit placeholder for every missing field rather than omitting it", () => {
    const info = buildBasicInfo(
      state({
        organisation: org({
          website: null,
          contact_email: null,
          address_line_1: null,
          postcode: null,
          city: null,
        }),
        missionStatement: null,
      }),
    );
    assert.equal(info.mission, "Not provided");
    assert.equal(info.email, "Not provided");
    assert.equal(info.address, "Not provided");
    assert.equal(info.website, "Not provided");
    // Location still falls back to country_code (visible-clients.ts behaviour) —
    // it is never "Not provided" since country_code is required on every row.
    assert.equal(info.location, "GB");
  });

  it("treats a blank string the same as a missing value", () => {
    const info = buildBasicInfo(
      state({ organisation: org({ contact_email: "   " }) }),
    );
    assert.equal(info.email, "Not provided");
  });

  it("uses only the parts of the address that are present", () => {
    const info = buildBasicInfo(
      state({ organisation: org({ address_line_1: "12 High Street", postcode: null }) }),
    );
    assert.equal(info.address, "12 High Street");
  });
});

describe("applyOrganisationChange", () => {
  it("merges an update for the organisation currently being viewed", () => {
    const next = applyOrganisationChange(state(), {
      eventType: "UPDATE",
      new: { id: "org-1", legal_name: "Renamed Charity" },
    });
    assert.equal(next.organisation.legal_name, "Renamed Charity");
    // Untouched fields survive the merge.
    assert.equal(next.organisation.contact_email, "hello@example.org");
  });

  it("ignores a change for a different organisation", () => {
    const initial = state();
    const next = applyOrganisationChange(initial, {
      eventType: "UPDATE",
      new: { id: "org-2", legal_name: "Someone Else" },
    });
    assert.equal(next, initial);
  });

  it("ignores a redacted payload with no id", () => {
    const initial = state();
    const next = applyOrganisationChange(initial, { eventType: "UPDATE", new: {} });
    assert.equal(next, initial);
  });

  it("leaves state alone on delete — the page handles a deleted client, not this panel", () => {
    const initial = state();
    const next = applyOrganisationChange(initial, {
      eventType: "DELETE",
      new: { id: "org-1" },
    });
    assert.equal(next, initial);
  });
});

describe("applyEnrichmentChange", () => {
  it("adopts a newer enrichment row's mission", () => {
    const next = applyEnrichmentChange(state(), {
      eventType: "INSERT",
      new: {
        organisation_id: "org-1",
        mission_statement: "Updated mission.",
        enriched_at: "2026-08-05T00:00:00Z",
      },
    });
    assert.equal(next.missionStatement, "Updated mission.");
    assert.equal(next.missionEnrichedAt, "2026-08-05T00:00:00Z");
  });

  it("drops an out-of-order row older than what is already shown", () => {
    const initial = state();
    const next = applyEnrichmentChange(initial, {
      eventType: "INSERT",
      new: {
        organisation_id: "org-1",
        mission_statement: "Stale mission.",
        enriched_at: "2026-07-01T00:00:00Z",
      },
    });
    assert.equal(next, initial);
  });

  it("ignores enrichment for a different organisation", () => {
    const initial = state();
    const next = applyEnrichmentChange(initial, {
      eventType: "INSERT",
      new: {
        organisation_id: "org-2",
        mission_statement: "Someone else's mission.",
        enriched_at: "2026-08-05T00:00:00Z",
      },
    });
    assert.equal(next, initial);
  });
});
