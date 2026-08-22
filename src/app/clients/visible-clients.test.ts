import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterByOwner,
  formatLocation,
  formatOutreachStatus,
  prioritiseQueue,
  prioritiseBySector,
  searchClients,
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

describe("searchClients", () => {
  const clients = visibleClients(
    [
      org({ id: "a", legal_name: "Bristol Food Bank" }),
      org({ id: "b", legal_name: "Cardiff Youth Trust" }),
      org({ id: "c", legal_name: "bristol animal rescue" }),
    ],
    [],
  );

  it("returns every client when no search term is given", () => {
    assert.deepEqual(searchClients(clients, undefined).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(searchClients(clients, null).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(searchClients(clients, "").map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(searchClients(clients, "   ").map((c) => c.id), ["a", "b", "c"]);
  });

  it("matches a substring of legal_name case-insensitively", () => {
    assert.deepEqual(searchClients(clients, "bristol").map((c) => c.id), ["a", "c"]);
    assert.deepEqual(searchClients(clients, "BRISTOL").map((c) => c.id), ["a", "c"]);
  });

  it("returns an empty list when nothing matches", () => {
    assert.deepEqual(searchClients(clients, "nonexistent"), []);
  });
});

describe("prioritiseQueue — geography only (F196 / F090 / F094)", () => {
  const clients = visibleClients(
    [
      org({ id: "1", legal_name: "Action for Children", city: "London", country_code: "GB", geographic_reach: "national" }),
      org({ id: "2", legal_name: "Barnsley Community Hub", city: "Barnsley", country_code: "GB", geographic_reach: "regional" }),
      org({ id: "3", legal_name: "Leeds Arts Trust", city: "Leeds", country_code: "GB", geographic_reach: "regional" }),
      org({ id: "4", legal_name: "Sheffield Wildlife Fund", city: "Sheffield", country_code: "GB", geographic_reach: "local" }),
      org({ id: "5", legal_name: "Yorkshire Wildlife Trust", city: "York", country_code: "GB", geographic_reach: "regional" }),
    ],
    [],
  );

  it("returns the unweighted default order when no preferences are passed", () => {
    assert.deepEqual(
      prioritiseQueue(clients, undefined).map((c) => c.id),
      ["1", "2", "3", "4", "5"],
    );
    assert.deepEqual(
      prioritiseQueue(clients, null).map((c) => c.id),
      ["1", "2", "3", "4", "5"],
    );
    assert.deepEqual(
      prioritiseQueue(clients, { preferred_geographic_reach: [], preferred_cities: [] }).map((c) => c.id),
      ["1", "2", "3", "4", "5"],
    );
  });

  it("prioritises organisations matching preferred target cities", () => {
    const result = prioritiseQueue(clients, {
      preferred_cities: ["Leeds", "Barnsley"],
      preferred_geographic_reach: [],
    });
    // Barnsley and Leeds appear at the top, sorted alphabetically by legal_name
    assert.deepEqual(result.map((c) => c.id), ["2", "3", "1", "4", "5"]);
  });

  it("prioritises Sheffield when local reach or Sheffield city is preferred", () => {
    const result = prioritiseQueue(clients, {
      preferred_cities: ["Sheffield"],
      preferred_geographic_reach: ["local"],
    });
    assert.equal(result[0].id, "4");
  });

  it("boosts South Yorkshire cities when South Yorkshire regional preference is set", () => {
    const result = prioritiseQueue(clients, {
      preferred_cities: ["South Yorkshire"],
      preferred_geographic_reach: [],
    });
    // Sheffield and Barnsley are South Yorkshire cities
    assert.ok(result.findIndex((c) => c.id === "4") < 2);
    assert.ok(result.findIndex((c) => c.id === "2") < 2);
  });

  it("prioritises matching geographic reach", () => {
    const result = prioritiseQueue(clients, {
      preferred_geographic_reach: ["national"],
      preferred_cities: [],
    });
    // National reaches first
    assert.equal(result[0].id, "1");
  });
});

describe("prioritiseBySector (F197 / F089 / F094)", () => {
  const clients = visibleClients(
    [
      org({ id: "1", legal_name: "Action for Children", sector: "Youth & Children", sub_sector: "Family Support" }),
      org({ id: "2", legal_name: "Barnsley Health Trust", sector: "Healthcare", sub_sector: "Hospital Services" }),
      org({ id: "3", legal_name: "Green Earth Initiative", sector: "Environment & Conservation", sub_sector: "Renewable Energy" }),
      org({ id: "4", legal_name: "Sheffield Literacy Project", sector: "Education & Training", sub_sector: "Adult Literacy" }),
      org({ id: "5", legal_name: "Yorkshire Food Relief", sector: "Poverty Relief", sub_sector: "Food Bank" }),
    ],
    [],
  );

  it("returns unweighted default order when no sector preferences are passed", () => {
    assert.deepEqual(
      prioritiseBySector(clients, undefined).map((c) => c.id),
      ["1", "2", "3", "4", "5"],
    );
    assert.deepEqual(
      prioritiseBySector(clients, { preferred_sectors: [] }).map((c) => c.id),
      ["1", "2", "3", "4", "5"],
    );
  });

  it("prioritises organisations matching preferred sector exactly or via substring", () => {
    const result = prioritiseBySector(clients, {
      preferred_sectors: ["Education & Training", "Poverty Relief"],
    });
    // Education (#4) and Poverty (#5) appear at the top, alphabetically
    assert.deepEqual(result.map((c) => c.id), ["4", "5", "1", "2", "3"]);
  });

  it("matches cross-source sector variations using keyword aliases (e.g. Health & Social Care -> Healthcare)", () => {
    const result = prioritiseBySector(clients, {
      preferred_sectors: ["Health & Social Care"],
    });
    // Barnsley Health Trust (#2 with sector: "Healthcare") matches alias
    assert.equal(result[0].id, "2");
  });

  it("matches sub_sector classifications", () => {
    const result = prioritiseBySector(clients, {
      preferred_sectors: ["Renewable Energy"],
    });
    assert.equal(result[0].id, "3");
  });

  it("matches aliases on whole words only — no accidental fragment boosts", () => {
    const result = prioritiseBySector(clients, {
      preferred_sectors: ["Arts & Culture"],
    });
    // None of these organisations is an arts organisation; raw substring
    // matching could previously boost via fragments of unrelated words.
    assert.deepEqual(result.map((c) => c.id), ["1", "2", "3", "4", "5"]);
  });

  it("does not let overlapping group vocabulary cross-match unrelated sectors", () => {
    const result = prioritiseBySector(clients, {
      preferred_sectors: ["Human Rights & Justice", "Social Enterprise"],
    });
    // Youth (#1) and poverty (#5) orgs share vocabulary with the justice and
    // community groups but are neither — they keep the unweighted tail order.
    assert.deepEqual(result.map((c) => c.id), ["1", "2", "3", "4", "5"]);
  });
});

describe("prioritiseQueue (Combined F196 + F197)", () => {
  const clients = visibleClients(
    [
      org({ id: "1", legal_name: "Alpha Bristol Health", city: "Bristol", sector: "Healthcare" }),
      org({ id: "2", legal_name: "Beta Sheffield Energy", city: "Sheffield", sector: "Renewable Energy" }),
      org({ id: "3", legal_name: "Gamma Sheffield Health", city: "Sheffield", sector: "Healthcare" }),
      org({ id: "4", legal_name: "Delta London Arts", city: "London", sector: "Arts & Culture" }),
    ],
    [],
  );

  it("ranks organisations matching both geography AND sector highest", () => {
    const result = prioritiseQueue(clients, {
      preferred_cities: ["Sheffield"],
      preferred_sectors: ["Health & Social Care"],
    });
    // Gamma Sheffield Health matches both Sheffield (+10) and Health (+8) -> total 18
    // Beta Sheffield Energy matches Sheffield (+10) -> total 10
    // Alpha Bristol Health matches Health (+8) -> total 8
    // Delta London Arts matches 0 -> total 0
    assert.deepEqual(result.map((c) => c.id), ["3", "2", "1", "4"]);
  });
});

