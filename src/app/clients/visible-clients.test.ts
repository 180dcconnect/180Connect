import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterByCity,
  filterByOwner,
  filterByTags,
  filterBySource,
  filterByStatus,
  formatLocation,
  formatOutreachStatus,
  prioritiseByGeography,
  prioritiseBySector,
  prioritiseBySize,
  prioritiseByGrants,
  prioritiseQueue,
  resolveClientIncomeBand,
  getGrantPriorityScore,
  parseListDirection,
  parseListSort,
  searchClients,
  sortClients,
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
    org_tags: overrides.org_tags ?? [],
  };
}
describe("formatLocation", () => {
  it("uses the city when present", () => {
    assert.equal(formatLocation(org({ city: "Bristol", country_code: "GB" })), "Bristol");
  });

  it("falls back to country_code when city is null", () => {
    assert.equal(formatLocation(org({ city: null, country_code: "FR" })), "FR");
  });

  it("falls back to country_code when city is blank", () => {
    assert.equal(formatLocation(org({ city: "  ", country_code: "GB" })), "GB");
  });
});

describe("formatOutreachStatus", () => {
  it("turns snake_case into a readable label", () => {
    assert.equal(formatOutreachStatus("not_contacted"), "Not contacted");
    assert.equal(formatOutreachStatus("responded"), "Responded");
  });
});

describe("visibleClients", () => {
  it("drops actively suppressed organisations", () => {
    const clients = [
      org({ id: "a", legal_name: "Good Cause" }),
      org({ id: "b", legal_name: "Blocked Cause" }),
      org({ id: "c", legal_name: "Another Good Cause" }),
    ];
    const suppressions = [{ organisation_id: "b", status: "active" as const }];

    const result = visibleClients(clients, suppressions);
    assert.deepEqual(
      result.map((c) => c.id),
      ["a", "c"],
    );
  });

  it("retains pending suppression requests but flags them", () => {
    const clients = [
      org({ id: "a", legal_name: "Pending Cause" }),
      org({ id: "b", legal_name: "Clear Cause" }),
    ];
    const suppressions = [{ organisation_id: "a", status: "pending" as const }];

    const result = visibleClients(clients, suppressions);
    assert.equal(result.length, 2);
    assert.equal(result[0].suppressionPending, true);
    assert.equal(result[1].suppressionPending, false);
  });

  it("resolves ownerName for assigned, unassigned, and deactivated owners (F162)", () => {
    const clients = [
      org({ id: "a", owner_id: "cam-1", owner: { full_name: "Alice" } }),
      org({ id: "b", owner_id: null, owner: null }),
      org({ id: "c", owner_id: "cam-deactivated", owner: null }),
    ];

    const result = visibleClients(clients, []);
    assert.equal(result[0].ownerName, "Alice");
    assert.equal(result[1].ownerName, null);
    assert.equal(result[2].ownerName, "A former team member");
  });
});

describe("filterByOwner (F163)", () => {
  const clients = visibleClients(
    [
      org({ id: "a", owner_id: "cam-1", owner: { full_name: "Alice" } }),
      org({ id: "b", owner_id: "cam-2", owner: { full_name: "Bob" } }),
      org({ id: "c", owner_id: null, owner: null }),
    ],
    [],
  );

  it("returns every client when ownerFilter is unset", () => {
    assert.deepEqual(filterByOwner(clients, undefined).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(filterByOwner(clients, null).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(filterByOwner(clients, "").map((c) => c.id), ["a", "b", "c"]);
  });

  it("isolates clients owned by a specific CAM", () => {
    assert.deepEqual(filterByOwner(clients, "cam-1").map((c) => c.id), ["a"]);
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

describe("filterByTags", () => {
  const clients = visibleClients(
    [
      org({ id: "a", org_tags: [{ tag_id: "urgent" }] }),
      org({ id: "b", org_tags: [{ tag_id: "urgent" }, { tag_id: "priority" }] }),
      org({ id: "c", org_tags: [{ tag_id: "priority" }] }),
      org({ id: "d", org_tags: [] }),
    ],
    [],
  );
  it("returns every client when no tags are selected", () => {
    assert.deepEqual(filterByTags(clients, undefined).map((c) => c.id), [
      "a", "b", "c", "d",
    ]);
    assert.deepEqual(filterByTags(clients, null).map((c) => c.id), [
      "a", "b", "c", "d",
    ]);
    assert.deepEqual(filterByTags(clients, []).map((c) => c.id), [
      "a", "b", "c", "d",
    ]);
  });
  it("matches clients with any of the selected tags (OR logic, per AC2)", () => {
    assert.deepEqual(filterByTags(clients, ["urgent"]).map((c) => c.id), [
      "a", "b",
    ]);
    assert.deepEqual(filterByTags(clients, ["priority"]).map((c) => c.id), [
      "b", "c",
    ]);
  });
  it("selecting multiple tags is a union, not an intersection", () => {
    assert.deepEqual(
      filterByTags(clients, ["urgent", "priority"]).map((c) => c.id),
      ["a", "b", "c"],
    );
  });
  it("excludes clients with none of the selected tags", () => {
    assert.deepEqual(filterByTags(clients, ["nonexistent-tag"]), []);
  });
  it("returns an empty list when filtering an empty client list", () => {
    assert.deepEqual(filterByTags([], ["urgent"]), []);
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
    assert.deepEqual(searchClients(clients, "manchester"), []);
  });
});

describe("filterByCity", () => {
  const clients = visibleClients(
    [
      org({ id: "a", city: "Bristol" }),
      org({ id: "b", city: "Cardiff" }),
      org({ id: "c", city: "bristol" }),
      org({ id: "d", city: null }),
    ],
    [],
  );

  it("returns every client when city filter is unset", () => {
    assert.deepEqual(filterByCity(clients, undefined).map((c) => c.id), ["a", "b", "c", "d"]);
    assert.deepEqual(filterByCity(clients, null).map((c) => c.id), ["a", "b", "c", "d"]);
    assert.deepEqual(filterByCity(clients, "").map((c) => c.id), ["a", "b", "c", "d"]);
  });

  it("matches city exact case-insensitively", () => {
    assert.deepEqual(filterByCity(clients, "Bristol").map((c) => c.id), ["a", "c"]);
    assert.deepEqual(filterByCity(clients, "cardiff").map((c) => c.id), ["b"]);
  });

  it("returns empty when city does not match any client", () => {
    assert.deepEqual(filterByCity(clients, "Sheffield"), []);
  });
});

describe("filterByStatus", () => {
  const clients = visibleClients(
    [
      org({ id: "a", outreach_status: "not_contacted" }),
      org({ id: "b", outreach_status: "contacted" }),
      org({ id: "c", outreach_status: "not_contacted" }),
    ],
    [],
  );

  it("returns every client when status filter is unset", () => {
    assert.deepEqual(filterByStatus(clients, undefined).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(filterByStatus(clients, null).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(filterByStatus(clients, "").map((c) => c.id), ["a", "b", "c"]);
  });

  it("matches against human-readable status label", () => {
    assert.deepEqual(filterByStatus(clients, "Not contacted").map((c) => c.id), ["a", "c"]);
    assert.deepEqual(filterByStatus(clients, "contacted").map((c) => c.id), ["b"]);
  });
});

describe("filterBySource", () => {
  const clients = visibleClients(
    [
      org({ id: "a", organisation_type: "charity" }),
      org({ id: "b", organisation_type: "company" }),
      org({ id: "c", organisation_type: "both" }),
      org({ id: "d", organisation_type: "other" }),
    ],
    [],
  );

  it("returns every client when source filter is unset", () => {
    assert.deepEqual(filterBySource(clients, undefined).map((c) => c.id), ["a", "b", "c", "d"]);
    assert.deepEqual(filterBySource(clients, null).map((c) => c.id), ["a", "b", "c", "d"]);
    assert.deepEqual(filterBySource(clients, "").map((c) => c.id), ["a", "b", "c", "d"]);
  });

  it("filters for charity commission organisations (including dual registered)", () => {
    assert.deepEqual(filterBySource(clients, "charity commission").map((c) => c.id), ["a", "c"]);
  });

  it("filters for companies house organisations (including dual registered)", () => {
    assert.deepEqual(filterBySource(clients, "companies house").map((c) => c.id), ["b", "c"]);
  });

  it("filters for strictly dual registered organisations", () => {
    assert.deepEqual(filterBySource(clients, "dual-registered").map((c) => c.id), ["c"]);
  });

  it("filters for other organisations", () => {
    assert.deepEqual(filterBySource(clients, "other").map((c) => c.id), ["d"]);
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

describe("resolveClientIncomeBand (F198)", () => {
  it("uses direct income_band property when present", () => {
    assert.equal(resolveClientIncomeBand(org({ income_band: "100k_1m" })), "100k_1m");
  });

  it("extracts latest income_band from financial_periods array sorted by period_end", () => {
    const client = org({
      financial_periods: [
        { income_band: "under_10k", period_end: "2024-03-31" },
        { income_band: "10k_100k", period_end: "2025-03-31" },
      ],
    });
    assert.equal(resolveClientIncomeBand(client), "10k_100k");
  });

  it("derives income_band from numeric total_income when financial_periods has no income_band enum", () => {
    const client = org({
      financial_periods: [{ total_income: 450_000, period_end: "2025-12-31" }],
    });
    assert.equal(resolveClientIncomeBand(client), "100k_1m");
  });

  it("falls back to top-level total_income", () => {
    assert.equal(resolveClientIncomeBand(org({ total_income: 15_000 })), "10k_100k");
  });

  it("returns null when no financial data exists", () => {
    assert.equal(resolveClientIncomeBand(org()), null);
  });
});

describe("prioritiseBySize (F198 / F091 / F094)", () => {
  const clients = visibleClients(
    [
      org({ id: "1", legal_name: "Alpha Micro Project", income_band: "under_10k" }),
      org({ id: "2", legal_name: "Beta Small Charity", income_band: "10k_100k" }),
      org({ id: "3", legal_name: "Gamma Medium Charity", income_band: "100k_1m" }),
      org({ id: "4", legal_name: "Delta Large Foundation", income_band: "over_1m" }),
      org({ id: "5", legal_name: "Epsilon Unfiled Org" }),
    ],
    [],
  );

  it("returns unweighted default order when no size preferences are provided", () => {
    assert.deepEqual(
      prioritiseBySize(clients, undefined).map((c) => c.id),
      ["1", "2", "3", "4", "5"],
    );
    assert.deepEqual(
      prioritiseBySize(clients, { preferred_income_bands: [] }).map((c) => c.id),
      ["1", "2", "3", "4", "5"],
    );
  });

  it("prioritises organisations matching preferred income bands", () => {
    const result = prioritiseBySize(clients, {
      preferred_income_bands: ["100k_1m", "over_1m"],
    });
    // Gamma (#3) and Delta (#4) at the top, sorted alphabetically
    assert.deepEqual(result.map((c) => c.id), ["4", "3", "1", "2", "5"]);
  });

  it("keeps matching organisations at the top and unprioritised ones in alphabetical order", () => {
    const result = prioritiseBySize(clients, {
      preferred_income_bands: ["under_10k"],
    });
    assert.deepEqual(
      result.map((c) => c.id),
      ["1", "2", "4", "5", "3"],
    );
  });
});

describe("prioritiseByGrants (F199 / F092 / F094)", () => {
  const clients = visibleClients(
    [
      org({ id: "1", legal_name: "Alpha Grant Recipient", grants: [{ id: "g1", funder_name: "National Lottery", amount_awarded: 50_000 }] }),
      org({ id: "2", legal_name: "Beta No Grants Org" }),
      org({ id: "3", legal_name: "Gamma Multi Grant Org", grants: [{ id: "g2", funder_name: "Trusthouse", amount_awarded: 20_000 }] }),
      org({ id: "4", legal_name: "Delta Unfunded Charity" }),
    ],
    [],
  );

  it("returns unweighted default order when grant prioritisation is false or unset", () => {
    assert.deepEqual(
      prioritiseByGrants(clients, undefined).map((c) => c.id),
      ["1", "2", "3", "4"],
    );
    assert.deepEqual(
      prioritiseByGrants(clients, { prioritise_grant_recipients: false }).map((c) => c.id),
      ["1", "2", "3", "4"],
    );
  });

  it("computes grant priority score correctly", () => {
    assert.equal(getGrantPriorityScore(clients[0], true), 10);
    assert.equal(getGrantPriorityScore(clients[1], true), 0);
    assert.equal(getGrantPriorityScore(clients[0], false), 0);
    assert.equal(getGrantPriorityScore(clients[0], null), 0);
  });

  it("prioritises organisations with previous grant history when enabled", () => {
    const result = prioritiseByGrants(clients, {
      prioritise_grant_recipients: true,
    });
    // Alpha (#1) and Gamma (#3) have grants, sorted alphabetically
    assert.deepEqual(result.map((c) => c.id), ["1", "3", "2", "4"]);
  });
});

describe("prioritiseQueue (Combined F196 + F197 + F198 + F199)", () => {
  const clients = visibleClients(
    [
      org({ id: "1", legal_name: "Alpha Bristol Health Small", city: "Bristol", sector: "Healthcare", income_band: "10k_100k", grants: [] }),
      org({ id: "2", legal_name: "Beta Sheffield Energy Medium", city: "Sheffield", sector: "Renewable Energy", income_band: "100k_1m", grants: [] }),
      org({ id: "3", legal_name: "Gamma Sheffield Health Medium Funded", city: "Sheffield", sector: "Healthcare", income_band: "100k_1m", grants: [{ id: "g1", funder_name: "Paul Hamlyn", amount_awarded: 100_000 }] }),
      org({ id: "4", legal_name: "Delta London Arts Large Funded", city: "London", sector: "Arts & Culture", income_band: "over_1m", grants: [{ id: "g2", funder_name: "Arts Council", amount_awarded: 50_000 }] }),
    ],
    [],
  );

  it("ranks organisations matching geography, sector, size, AND grant history highest", () => {
    const result = prioritiseQueue(clients, {
      preferred_cities: ["Sheffield"],
      preferred_sectors: ["Health & Social Care"],
      preferred_income_bands: ["100k_1m"],
      prioritise_grant_recipients: true,
    });
    // Gamma matches all 4 (City: 10 + Sector: 8 + Size: 10 + Grants: 10 = 38)
    // Beta matches City: 10 + Size: 10 = 20
    // Delta matches Grants: 10 = 10
    // Alpha matches Sector: 8 = 8
    assert.deepEqual(result.map((c) => c.id), ["3", "2", "4", "1"]);

/* ─── List sorting (F060 #62, F061 #63) ────────────────────────────────── */

/** sortClients works on VisibleClient, so fixtures go through visibleClients()
 * once — the same path the page uses, so `location` and `outreachStatusLabel`
 * are derived rather than hand-written and can't drift from the real ones. */
function listOf(rows: Partial<ClientListRow>[]) {
  return visibleClients(
    rows.map((row, index) => org({ id: `org-${index}`, ...row })),
    [],
  );
}

const names = (clients: { legal_name: string }[]) => clients.map((c) => c.legal_name);

describe("parseListSort", () => {
  it("accepts the three sortable fields", () => {
    assert.equal(parseListSort("name"), "name");
    assert.equal(parseListSort("location"), "location");
    assert.equal(parseListSort("status"), "status");
  });

  it("falls back to name for anything else", () => {
    assert.equal(parseListSort("owner"), "name");
    assert.equal(parseListSort(undefined), "name");
    assert.equal(parseListSort(""), "name");
    assert.equal(parseListSort("'; drop table organisations; --"), "name");
  });
});

describe("parseListDirection", () => {
  it("only descending is descending", () => {
    assert.equal(parseListDirection("descending"), "descending");
    assert.equal(parseListDirection("ascending"), "ascending");
    assert.equal(parseListDirection("desc"), "ascending");
    assert.equal(parseListDirection(undefined), "ascending");
  });
});

describe("sortClients by name", () => {
  it("sorts alphabetically, ignoring case", () => {
    const clients = listOf([
      { legal_name: "zebra trust" },
      { legal_name: "Apple Fund" },
      { legal_name: "Mango Aid" },
    ]);
    assert.deepEqual(names(sortClients(clients, "name", "ascending")), [
      "Apple Fund",
      "Mango Aid",
      "zebra trust",
    ]);
  });

  it("reverses on descending", () => {
    const clients = listOf([{ legal_name: "Apple Fund" }, { legal_name: "Mango Aid" }]);
    assert.deepEqual(names(sortClients(clients, "name", "descending")), [
      "Mango Aid",
      "Apple Fund",
    ]);
  });

  it("leaves the caller's array alone", () => {
    const clients = listOf([{ legal_name: "Zebra" }, { legal_name: "Apple" }]);
    sortClients(clients, "name", "ascending");
    assert.deepEqual(names(clients), ["Zebra", "Apple"]);
  });

  it("returns an empty list unchanged", () => {
    assert.deepEqual(sortClients([], "location", "descending"), []);
  });
});

describe("sortClients by location (F060)", () => {
  it("sorts alphabetically on the displayed location", () => {
    const clients = listOf([
      { legal_name: "C", city: "York" },
      { legal_name: "A", city: "Bristol" },
      { legal_name: "B", city: "Leeds" },
    ]);
    assert.deepEqual(names(sortClients(clients, "location", "ascending")), ["A", "B", "C"]);
  });

  it("groups clients sharing a location adjacently, in name order (AC2)", () => {
    const clients = listOf([
      { legal_name: "Sheffield Two", city: "Sheffield" },
      { legal_name: "Bristol One", city: "Bristol" },
      { legal_name: "Sheffield One", city: "Sheffield" },
      { legal_name: "Bristol Two", city: "Bristol" },
    ]);
    assert.deepEqual(names(sortClients(clients, "location", "ascending")), [
      "Bristol One",
      "Bristol Two",
      "Sheffield One",
      "Sheffield Two",
    ]);
  });

  it("keeps the group together on descending, and the names inside it ascending", () => {
    const clients = listOf([
      { legal_name: "Sheffield Two", city: "Sheffield" },
      { legal_name: "Bristol One", city: "Bristol" },
      { legal_name: "Sheffield One", city: "Sheffield" },
    ]);
    assert.deepEqual(names(sortClients(clients, "location", "descending")), [
      "Sheffield One",
      "Sheffield Two",
      "Bristol One",
    ]);
  });

  it("sorts a missing city on its country code, the value the list shows", () => {
    const clients = listOf([
      { legal_name: "Has city", city: "Zanzibar" },
      { legal_name: "No city", city: null, country_code: "AL" },
    ]);
    assert.deepEqual(names(sortClients(clients, "location", "ascending")), [
      "No city",
      "Has city",
    ]);
  });
});

describe("sortClients by outreach status (F061)", () => {
  it("follows pipeline order, not alphabetical order of the label (AC1)", () => {
    const clients = listOf([
      { legal_name: "Converted", outreach_status: "converted" },
      { legal_name: "Initial", outreach_status: "initial_outreach_sent" },
      { legal_name: "Not contacted", outreach_status: "not_contacted" },
    ]);
    // Alphabetically the labels would be Converted, Initial…, Not contacted.
    assert.deepEqual(names(sortClients(clients, "status", "ascending")), [
      "Not contacted",
      "Initial",
      "Converted",
    ]);
  });

  it("reverses the pipeline order on descending", () => {
    const clients = listOf([
      { legal_name: "Not contacted", outreach_status: "not_contacted" },
      { legal_name: "Converted", outreach_status: "converted" },
    ]);
    assert.deepEqual(names(sortClients(clients, "status", "descending")), [
      "Converted",
      "Not contacted",
    ]);
  });

  it("orders clients in the same status by name", () => {
    const clients = listOf([
      { legal_name: "Beta", outreach_status: "responded" },
      { legal_name: "Alpha", outreach_status: "responded" },
    ]);
    assert.deepEqual(names(sortClients(clients, "status", "ascending")), ["Alpha", "Beta"]);
  });

  it("sorts an unrecognised status last rather than first", () => {
    const clients = listOf([
      { legal_name: "Unknown", outreach_status: "invented_status" },
      { legal_name: "Converted", outreach_status: "converted" },
      { legal_name: "Not contacted", outreach_status: "not_contacted" },
    ]);
    assert.deepEqual(names(sortClients(clients, "status", "ascending")), [
      "Not contacted",
      "Converted",
      "Unknown",
    ]);
  });
});

describe("sortClients combined with filters (F060 AC3 / F061 AC2)", () => {
  it("sorts only what the filter left behind", () => {
    const clients = listOf([
      { legal_name: "Owned York", city: "York", owner_id: "cam-1" },
      { legal_name: "Other Bristol", city: "Bristol", owner_id: "cam-2" },
      { legal_name: "Owned Bristol", city: "Bristol", owner_id: "cam-1" },
    ]);
    const mine = filterByOwner(clients, "cam-1");
    assert.deepEqual(names(sortClients(mine, "location", "ascending")), [
      "Owned Bristol",
      "Owned York",
    ]);
  });

  it("sorts what the search left behind", () => {
    const clients = listOf([
      { legal_name: "Trust Zed", outreach_status: "converted" },
      { legal_name: "Unrelated", outreach_status: "not_contacted" },
      { legal_name: "Trust Alpha", outreach_status: "not_contacted" },
    ]);
    const found = searchClients(clients, "trust");
    assert.deepEqual(names(sortClients(found, "status", "ascending")), [
      "Trust Alpha",
      "Trust Zed",
    ]);
  });
});
