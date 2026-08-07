import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterByOwner,
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
    outreach_status: "not_contacted",
    owner_id: null,
    owner: null,
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
    assert.equal(formatOutreachStatus("not_contacted"), "Not contacted");
    assert.equal(formatOutreachStatus("responded"), "Responded");
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
      org({ id: "a", city: null, country_code: "GB", outreach_status: "follow_up_sent" }),
    ];
    const result = visibleClients(organisations, []);
    assert.equal(result[0].location, "GB");
    assert.equal(result[0].outreachStatusLabel, "Follow up sent");
  });

  it("F162: ownerName is null only for a genuinely unassigned client", () => {
    const organisations = [org({ id: "a", owner_id: null, owner: null })];
    const result = visibleClients(organisations, []);
    assert.equal(result[0].ownerName, null);
  });

  it("F162: ownerName carries the owning CAM's name", () => {
    const organisations = [
      org({ id: "a", owner_id: "cam-1", owner: { full_name: "Jane CAM" } }),
    ];
    const result = visibleClients(organisations, []);
    assert.equal(result[0].ownerName, "Jane CAM");
  });

  it("F162: falls back to a label when the owner is set but their row is hidden (deactivated)", () => {
    const organisations = [org({ id: "a", owner_id: "cam-1", owner: null })];
    const result = visibleClients(organisations, []);
    assert.equal(result[0].ownerName, "A former team member");
  });
});

describe("filterByOwner", () => {
  const clients = visibleClients(
    [
      org({ id: "a", owner_id: "cam-1", owner: { full_name: "Jane CAM" } }),
      org({ id: "b", owner_id: "cam-2", owner: { full_name: "Sam CAM" } }),
      org({ id: "c", owner_id: null, owner: null }),
    ],
    [],
  );

  it("returns every client when no filter is given", () => {
    assert.deepEqual(filterByOwner(clients, undefined).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(filterByOwner(clients, null).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(filterByOwner(clients, "").map((c) => c.id), ["a", "b", "c"]);
  });

  it("narrows to one CAM's clients", () => {
    assert.deepEqual(filterByOwner(clients, "cam-1").map((c) => c.id), ["a"]);
  });

  it("supports the 'my clients' shortcut, which is just a CAM id filter", () => {
    assert.deepEqual(filterByOwner(clients, "cam-2").map((c) => c.id), ["b"]);
  });

  it("surfaces unassigned clients under the distinct 'unassigned' value", () => {
    assert.deepEqual(filterByOwner(clients, "unassigned").map((c) => c.id), ["c"]);
  });

  it("returns an empty list for a CAM who owns nothing in view", () => {
    assert.deepEqual(filterByOwner(clients, "cam-3"), []);
  });

  it("returns an empty list when filtering an empty client list", () => {
    assert.deepEqual(filterByOwner([], "cam-1"), []);
  });
});
