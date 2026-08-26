import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bandForScore,
} from "../../lib/scoring/score-client.ts";
import {
  filterByCity,
  filterByOwner,
  filterByTags,
  filterByStatus,
  filterByPriorityScore,
  formatLocation,
  formatOutreachStatus,
  parsePriorityScoreFilter,
  prioritiseBySector,
  prioritiseBySize,
  prioritiseByGrants,
  prioritiseQueue,
  hasActiveQueuePreferences,
  resolveClientIncomeBand,
  getGrantPriorityScore,
  filterByCountry,
  filterByType,
  filterBySector,
  UNCLASSIFIED_SECTOR,
  filterValues,
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
  });
});

/* ─── F094 — the queue layered on top of the base score ────────────────── */

describe("prioritiseQueue ties break on the base score (F094 AC1)", () => {
  const clients = visibleClients(
    [
      // Both Leeds orgs tie on the preference total (city match = +10); the
      // persisted base score must decide between them, not the alphabet.
      org({
        id: "match-low",
        legal_name: "Zed Leeds Charity",
        city: "Leeds",
        latest_scores: { priority_score: 0.2, priority_band: "low", scored_at: null },
      }),
      org({
        id: "match-high",
        legal_name: "Alpha Leeds Charity",
        city: "Leeds",
        latest_scores: { priority_score: 0.9, priority_band: "high", scored_at: null },
      }),
      // Highest base score on the board, but no preference match: preferences
      // lead, so it stays behind both matches ("layered on top", not replaced).
      org({
        id: "nomatch-top-score",
        legal_name: "Bristol Perfect Score",
        city: "Bristol",
        latest_scores: { priority_score: 1.0, priority_band: "high", scored_at: null },
      }),
    ],
    [],
  );

  it("ranks equal preference totals by base score descending", () => {
    const result = prioritiseQueue(clients, { preferred_cities: ["leeds"] });
    assert.deepEqual(result.map((c) => c.id), ["match-high", "match-low", "nomatch-top-score"]);
  });

  it("pins unscored clients below scored ones inside a tie group", () => {
    const rows = visibleClients(
      [
        org({ id: "unscored", legal_name: "A Unscored Leeds Org", city: "Leeds" }),
        org({
          id: "scored",
          legal_name: "B Scored Leeds Org",
          city: "Leeds",
          latest_scores: { priority_score: 0.1, priority_band: "low", scored_at: null },
        }),
      ],
      [],
    );
    const result = prioritiseQueue(rows, { preferred_cities: ["leeds"] });
    assert.deepEqual(result.map((c) => c.id), ["scored", "unscored"]);
  });

  it("pins unscored clients even against a zero base score", () => {
    const rows = visibleClients(
      [
        org({ id: "unscored", legal_name: "A Unscored Org", city: "Leeds" }),
        org({
          id: "zero",
          legal_name: "B Zero Score Org",
          city: "Leeds",
          latest_scores: { priority_score: 0, priority_band: "low", scored_at: null },
        }),
      ],
      [],
    );
    const result = prioritiseQueue(rows, { preferred_cities: ["leeds"] });
    assert.deepEqual(result.map((c) => c.id), ["zero", "unscored"]);
  });

  it("falls back to a stable name order when every client is unscored (missing scoring inputs)", () => {
    const rows = visibleClients(
      [
        org({ id: "c", legal_name: "Charlie Org" }),
        org({ id: "a", legal_name: "Alpha Org" }),
        org({ id: "b", legal_name: "Bravo Org" }),
      ],
      [],
    );
    const result = prioritiseQueue(rows, { preferred_cities: ["sheffield"] });
    assert.deepEqual(names(result), ["Alpha Org", "Bravo Org", "Charlie Org"]);
  });
});

describe("prioritiseQueue diverges per CAM (F094 AC2)", () => {
  const clients = visibleClients(
    [
      org({ id: "1", legal_name: "Sheffield Health Small", city: "Sheffield", sector: "Healthcare", income_band: "10k_100k" }),
      org({ id: "2", legal_name: "London Arts Large", city: "London", sector: "Arts & Culture", income_band: "over_1m" }),
      org({ id: "3", legal_name: "Sheffield Arts Medium", city: "Sheffield", sector: "Arts & Culture", income_band: "100k_1m" }),
    ],
    [],
  );

  it("two CAMs with different preferences see different orders over the same clients", () => {
    const geographicCAM = prioritiseQueue(clients, { preferred_cities: ["sheffield"] });
    const artsCAM = prioritiseQueue(clients, { preferred_sectors: ["arts & culture"] });

    // Each CAM's own matches lead their queue, and the two queues disagree.
    // Neither CAM's matches carry a stored score here, so ties read A–Z:
    // "…Arts Medium" before "…Health Small" for the geographic CAM.
    assert.deepEqual(geographicCAM.map((c) => c.id).slice(0, 2), ["3", "1"]);
    assert.deepEqual(artsCAM.map((c) => c.id).slice(0, 2), ["2", "3"]);
    assert.notDeepEqual(geographicCAM.map((c) => c.id), artsCAM.map((c) => c.id));
  });

  it("changing a preference re-orders on the next read without touching stored scores (F094 AC3)", () => {
    const rows = [
      org({ id: "1", legal_name: "Sheffield Health Small", city: "Sheffield", sector: "Healthcare", latest_scores: { priority_score: 0.4, priority_band: "medium", scored_at: null } }),
      org({ id: "2", legal_name: "London Arts Large", city: "London", sector: "Arts & Culture", latest_scores: { priority_score: 0.6, priority_band: "medium", scored_at: null } }),
      org({ id: "3", legal_name: "Sheffield Arts Medium", city: "Sheffield", sector: "Arts & Culture", latest_scores: { priority_score: 0.5, priority_band: "medium", scored_at: null } }),
    ];
    const before = visibleClients(rows, []);

    const first = prioritiseQueue(before, { preferred_cities: ["sheffield"] });
    const second = prioritiseQueue(before, { preferred_sectors: ["arts & culture"] });

    // The queue follows the new preference immediately — no re-score involved.
    // Geographic CAM: the two Sheffield orgs tie (+20 each) and #3's higher
    // base score wins the tie. Arts CAM: #2 and #3 tie on sector and #2's
    // base score is higher.
    assert.deepEqual(first.map((c) => c.id).slice(0, 2), ["3", "1"]);
    assert.deepEqual(second.map((c) => c.id).slice(0, 2), ["2", "3"]);

    // The stored base scores are only ever read: every input row keeps its
    // score, band, and original order.
    assert.deepEqual(
      before.map((c) => [c.id, c.priorityScore, c.priorityBand]),
      [["1", 0.4, "medium"], ["2", 0.6, "medium"], ["3", 0.5, "medium"]],
    );
    assert.deepEqual(before.map((c) => c.id), ["1", "2", "3"]);
  });
});

describe("hasActiveQueuePreferences (F094 default-view flag)", () => {
  it("is false for missing or empty preference rows", () => {
    assert.equal(hasActiveQueuePreferences(undefined), false);
    assert.equal(hasActiveQueuePreferences(null), false);
    assert.equal(hasActiveQueuePreferences({}), false);
    assert.equal(
      hasActiveQueuePreferences({
        preferred_geographic_reach: [],
        preferred_cities: [],
        preferred_sectors: [],
        preferred_income_bands: [],
        prioritise_grant_recipients: false,
      }),
      false,
    );
  });

  it("treats whitespace-only values as inactive, matching prioritiseQueue", () => {
    assert.equal(hasActiveQueuePreferences({ preferred_cities: ["   "] }), false);
    assert.equal(hasActiveQueuePreferences({ preferred_cities: ["sheffield"] }), true);
  });

  it("counts any single active dimension", () => {
    assert.equal(hasActiveQueuePreferences({ preferred_geographic_reach: ["local"] }), true);
    assert.equal(hasActiveQueuePreferences({ preferred_sectors: ["health"] }), true);
    assert.equal(hasActiveQueuePreferences({ preferred_income_bands: ["10k_100k"] }), true);
    assert.equal(hasActiveQueuePreferences({ prioritise_grant_recipients: true }), true);
  });
});

describe("explicit sort overrides the personal queue default (F094 / F060)", () => {
  it("an explicit name sort applied after prioritisation restores alphabetical order", () => {
    const clients = visibleClients(
      [
        org({ id: "1", legal_name: "Zulu Sheffield Org", city: "Sheffield" }),
        org({ id: "2", legal_name: "Alpha London Org", city: "London" }),
      ],
      [],
    );
    const queued = prioritiseQueue(clients, { preferred_cities: ["sheffield"] });
    assert.deepEqual(queued.map((c) => c.id), ["1", "2"]);

    // What page.tsx does when ?listSort= is present: the CAM's explicit choice
    // wins over the personalisation.
    const overridden = sortClients(queued, "name", "ascending");
    assert.deepEqual(names(overridden), ["Alpha London Org", "Zulu Sheffield Org"]);
  });
});

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
  it("accepts the four sortable fields", () => {
    assert.equal(parseListSort("name"), "name");
    assert.equal(parseListSort("location"), "location");
    assert.equal(parseListSort("status"), "status");
    assert.equal(parseListSort("priority"), "priority");
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

  it("keeps an unrecognised status last on descending too — never first (regression)", () => {
    const clients = listOf([
      { legal_name: "Unknown", outreach_status: "invented_status" },
      { legal_name: "Converted", outreach_status: "converted" },
      { legal_name: "Not contacted", outreach_status: "not_contacted" },
    ]);
    assert.deepEqual(names(sortClients(clients, "status", "descending")), [
      "Converted",
      "Not contacted",
      "Unknown",
    ]);
  });

  it("ties two unrecognised statuses by name in either direction", () => {
    const clients = listOf([
      { legal_name: "Zeta", outreach_status: "invented_b" },
      { legal_name: "Alpha", outreach_status: "invented_a" },
    ]);
    assert.deepEqual(names(sortClients(clients, "status", "ascending")), ["Alpha", "Zeta"]);
    assert.deepEqual(names(sortClients(clients, "status", "descending")), ["Alpha", "Zeta"]);
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

/* ─── Multi-select filters (F053 #55, F054 #56, F056 #58) ──────────────── */

describe("filterValues", () => {
  it("accepts a single value, an array, or nothing", () => {
    assert.deepEqual(filterValues("Leeds"), ["Leeds"]);
    assert.deepEqual(filterValues(["Leeds", "York"]), ["Leeds", "York"]);
    assert.deepEqual(filterValues(undefined), []);
    assert.deepEqual(filterValues(null), []);
  });

  it("drops blanks, so a stray ?city= shows everything rather than nothing", () => {
    assert.deepEqual(filterValues(""), []);
    assert.deepEqual(filterValues(["Leeds", "", "  "]), ["Leeds"]);
  });
});

describe("filterByType (F053)", () => {
  const clients = listOf([
    { legal_name: "A charity", organisation_type: "charity" },
    { legal_name: "A company", organisation_type: "company" },
    { legal_name: "Both", organisation_type: "both" },
    { legal_name: "Other", organisation_type: "other" },
  ]);

  it("filters on the stored type value", () => {
    assert.deepEqual(names(filterByType(clients, "charity")), ["A charity"]);
  });

  it("AC2 — several types show clients matching any of them", () => {
    assert.deepEqual(names(filterByType(clients, ["charity", "company"])), [
      "A charity",
      "A company",
    ]);
  });

  it("does not treat 'both' as a match for charity or company", () => {
    // "both" is its own standardised value, not a wildcard. The old
    // source-based filter folded it into each, which is why no combination of
    // options could express a plain union.
    assert.deepEqual(names(filterByType(clients, "charity")), ["A charity"]);
  });

  it("an unknown value matches nothing, rather than silently showing everything", () => {
    assert.deepEqual(names(filterByType(clients, "Charity Commission")), []);
    assert.deepEqual(names(filterByType(clients, ["charity", "nonsense"])), ["A charity"]);
  });

  it("no filter shows everything", () => {
    assert.equal(filterByType(clients, undefined).length, 4);
    assert.equal(filterByType(clients, []).length, 4);
  });
});

describe("filterBySector (F055)", () => {
  const clients = listOf([
    { legal_name: "A clinic", sector: "Healthcare", sub_sector: null },
    { legal_name: "A school", sector: null, sub_sector: "Schools & Colleges" },
    { legal_name: "A food bank", sector: "Poverty Relief", sub_sector: null },
    { legal_name: "An unclassified one", sector: null, sub_sector: null },
    { legal_name: "A blank-string one", sector: "  ", sub_sector: null },
  ]);

  it("matches free-text sector values through the canonical alias table, case-insensitively", () => {
    assert.deepEqual(names(filterBySector(clients, "health")), ["A clinic"]);
    assert.deepEqual(names(filterBySector(clients, "education")), ["A school"]);
  });

  it("matches on sub-sector when the sector field itself is empty", () => {
    // The school has no `sector`, only a sub-sector — it is still classified.
    assert.deepEqual(names(filterBySector(clients, UNCLASSIFIED_SECTOR)), [
      "An unclassified one",
      "A blank-string one",
    ]);
  });

  it("AC2 — several sectors show clients matching any of them", () => {
    assert.deepEqual(names(filterBySector(clients, ["health", "poverty"])), [
      "A clinic",
      "A food bank",
    ]);
  });

  it("AC3 — 'unclassified' selects charities with no sector recorded", () => {
    const mixed = filterBySector(clients, ["education", UNCLASSIFIED_SECTOR]);
    assert.deepEqual(names(mixed), ["A school", "An unclassified one", "A blank-string one"]);
  });

  it("an unknown value matches nothing, rather than silently showing everything", () => {
    assert.deepEqual(names(filterBySector(clients, "Charity Commission")), []);
    assert.deepEqual(
      names(filterBySector(clients, ["health", "nonsense"])),
      ["A clinic"],
    );
  });

  it("no filter shows everything", () => {
    assert.equal(filterBySector(clients, undefined).length, 5);
    assert.equal(filterBySector(clients, []).length, 5);
  });
});

describe("filterByCity (F054)", () => {
  const clients = listOf([
    { legal_name: "Leeds one", city: "Leeds" },
    { legal_name: "York one", city: "York" },
    { legal_name: "Hull one", city: "Hull" },
    { legal_name: "No city", city: null, country_code: "FR" },
  ]);

  it("matches case-insensitively", () => {
    assert.deepEqual(names(filterByCity(clients, "leeds")), ["Leeds one"]);
  });

  it("AC — several cities show clients in any of them", () => {
    assert.deepEqual(names(filterByCity(clients, ["Leeds", "Hull"])), [
      "Leeds one",
      "Hull one",
    ]);
  });

  it("never matches a client with no city", () => {
    assert.deepEqual(names(filterByCity(clients, ["Leeds", "York", "Hull"])), [
      "Leeds one",
      "York one",
      "Hull one",
    ]);
  });
});

describe("filterByCountry (F054 AC1)", () => {
  const clients = listOf([
    { legal_name: "British", country_code: "GB" },
    { legal_name: "French", country_code: "FR" },
    { legal_name: "Dutch", country_code: "NL" },
  ]);

  it("filters on country_code, case-insensitively", () => {
    assert.deepEqual(names(filterByCountry(clients, "gb")), ["British"]);
  });

  it("supports several countries at once", () => {
    assert.deepEqual(names(filterByCountry(clients, ["FR", "NL"])), ["French", "Dutch"]);
  });

  it("combines with a city filter rather than replacing it", () => {
    const mixed = listOf([
      { legal_name: "Leeds GB", city: "Leeds", country_code: "GB" },
      { legal_name: "Leeds NL", city: "Leeds", country_code: "NL" },
      { legal_name: "York GB", city: "York", country_code: "GB" },
    ]);
    assert.deepEqual(names(filterByCountry(filterByCity(mixed, "Leeds"), "GB")), ["Leeds GB"]);
  });
});

describe("filterByStatus (F056)", () => {
  const clients = listOf([
    { legal_name: "Fresh", outreach_status: "not_contacted" },
    { legal_name: "Replied", outreach_status: "responded" },
    { legal_name: "Won", outreach_status: "converted" },
  ]);

  it("matches the stored enum value, which the label used to break", () => {
    // The old filter matched "Not contacted" and returned nothing for the value
    // the database actually holds.
    assert.deepEqual(names(filterByStatus(clients, "not_contacted")), ["Fresh"]);
  });

  it("does not match the formatted label", () => {
    assert.deepEqual(names(filterByStatus(clients, "Not contacted")), []);
  });

  it("AC3 — several statuses show clients in any of them", () => {
    assert.deepEqual(names(filterByStatus(clients, ["responded", "converted"])), [
      "Replied",
      "Won",
    ]);
  });

  it("no filter shows everything", () => {
    assert.equal(filterByStatus(clients, []).length, 3);
  });
});

/* ─── Priority score (F058 #60, F059 #61) ──────────────────────────────── */

/** A fixture with a persisted LATEST_SCORES row, as the page's embedded join
 * delivers it. Array form exercised separately below. */
function scored(
  legal_name: string,
  priority_score: number | null,
  priority_band: string | null = null,
): Partial<ClientListRow> {
  return {
    legal_name,
    latest_scores: {
      priority_score,
      priority_band:
        priority_band ?? (priority_score === null ? null : bandForScore(priority_score)),
      scored_at: "2026-08-24T10:00:00Z",
    },
  };
}

describe("visibleClients — normalising the LATEST_SCORES join", () => {
  it("carries the persisted score and band onto the visible client", () => {
    const [client] = listOf([scored("Scored", 0.82, "high")]);
    assert.equal(client.priorityScore, 0.82);
    assert.equal(client.priorityBand, "high");
  });

  it("treats a missing row as explicitly unscored, not zero", () => {
    const [client] = listOf([{ legal_name: "Unscored" }]);
    assert.equal(client.priorityScore, null);
    assert.equal(client.priorityBand, null);
  });

  it("survives the join arriving as an array instead of an object", () => {
    const [client] = visibleClients(
      [
        org({
          id: "arr",
          legal_name: "Array Shape",
          latest_scores: [{ priority_score: 0.55, priority_band: "medium", scored_at: null }],
        }),
      ],
      [],
    );
    assert.equal(client.priorityScore, 0.55);
    assert.equal(client.priorityBand, "medium");
  });

  it("degrades an out-of-vocabulary band to unscored rather than leaking it", () => {
    const [client] = visibleClients(
      [
        org({
          id: "weird",
          legal_name: "Weird Band",
          latest_scores: { priority_score: 0.9, priority_band: "transcendent", scored_at: null },
        }),
      ],
      [],
    );
    assert.equal(client.priorityScore, 0.9);
    assert.equal(client.priorityBand, null);
  });
});

describe("parsePriorityScoreFilter", () => {
  it("keeps known bands and drops junk URL input", () => {
    assert.deepEqual(parsePriorityScoreFilter(["high", "banana", "unscored"]), [
      "high",
      "unscored",
    ]);
  });

  it("returns nothing for absent or blank input", () => {
    assert.deepEqual(parsePriorityScoreFilter(undefined), []);
    assert.deepEqual(parsePriorityScoreFilter(["", "  "]), []);
  });
});

describe("filterByPriorityScore (F058)", () => {
  const clients = listOf([
    scored("High", 0.85),
    scored("Medium", 0.5),
    scored("Low", 0.2),
    { legal_name: "Never Scored" },
  ]);

  it("AC1 — one band alone is the range above or below its cut-off", () => {
    assert.deepEqual(names(filterByPriorityScore(clients, "high")), ["High"]);
    assert.deepEqual(names(filterByPriorityScore(clients, "low")), ["Low"]);
  });

  it("AC1 — several bands union into 'within' ranges", () => {
    assert.deepEqual(names(filterByPriorityScore(clients, ["high", "medium"])), [
      "High",
      "Medium",
    ]);
  });

  it("AC3 — unscored clients appear only when explicitly selected", () => {
    assert.deepEqual(names(filterByPriorityScore(clients, "unscored")), ["Never Scored"]);
    // And no selection at all shows everyone, unscored included.
    assert.equal(filterByPriorityScore(clients, []).length, 4);
    assert.equal(filterByPriorityScore(clients, undefined).length, 4);
  });

  it("matches the persisted band, not a re-derived one", () => {
    // The stored band is what scoring wrote; the filter must not invent
    // cut-offs that could drift from it.
    const banded = listOf([
      { legal_name: "Says High", latest_scores: { priority_score: 0.41, priority_band: "high", scored_at: null } },
    ]);
    assert.deepEqual(names(filterByPriorityScore(banded, "high")), ["Says High"]);
    assert.deepEqual(names(filterByPriorityScore(banded, "medium")), []);
  });
});

describe("sortClients by priority score (F059)", () => {
  const clients = listOf([
    { legal_name: "Charlie", ...scored("Charlie", 0.5) },
    { legal_name: "Alpha", ...scored("Alpha", 0.9) },
    { legal_name: "Unscored", latest_scores: null },
    { legal_name: "Bravo", ...scored("Bravo", 0.1) },
    { legal_name: "Also Unscored", latest_scores: null },
  ]);

  it("AC1 — descending puts the highest score first", () => {
    assert.deepEqual(names(sortClients(clients, "priority", "descending")), [
      "Alpha",
      "Charlie",
      "Bravo",
      "Also Unscored",
      "Unscored",
    ]);
  });

  it("AC1 — ascending puts the lowest score first", () => {
    assert.deepEqual(names(sortClients(clients, "priority", "ascending")), [
      "Bravo",
      "Charlie",
      "Alpha",
      "Also Unscored",
      "Unscored",
    ]);
  });

  it("pins unscored last in both directions, in name order within the group", () => {
    for (const direction of ["ascending", "descending"] as const) {
      const ordered = names(sortClients(clients, "priority", direction));
      assert.deepEqual(ordered.slice(-2), ["Also Unscored", "Unscored"], direction);
    }
  });

  it("ties break on legal_name ascending, not reversed by descending", () => {
    const tied = listOf([
      { legal_name: "Zebra", ...scored("Zebra", 0.7) },
      { legal_name: "Aardvark", ...scored("Aardvark", 0.7) },
    ]);
    for (const direction of ["ascending", "descending"] as const) {
      assert.deepEqual(names(sortClients(tied, "priority", direction)), [
        "Aardvark",
        "Zebra",
      ]);
    }
  });

  it("sorts an empty list without complaint", () => {
    assert.deepEqual(sortClients([], "priority", "descending"), []);
  });
});

describe("F058 + F059 combined (F059 AC3)", () => {
  const clients = listOf([
    { legal_name: "Filtered In High", city: "Leeds", ...scored("Filtered In High", 0.95) },
    { legal_name: "Filtered Out Low", city: "Leeds", ...scored("Filtered Out Low", 0.15) },
    { legal_name: "Other City High", city: "Hull", ...scored("Other City High", 0.8) },
  ]);

  it("filters to a city, then sorts that filtered set by score", () => {
    const leeds = filterByCity(clients, "Leeds");
    assert.deepEqual(names(sortClients(leeds, "priority", "descending")), [
      "Filtered In High",
      "Filtered Out Low",
    ]);
  });

  it("a score band plus a sort respects both", () => {
    const highOnly = filterByPriorityScore(clients, "high");
    assert.deepEqual(names(sortClients(highOnly, "priority", "ascending")), [
      "Other City High",
      "Filtered In High",
    ]);
  });
});
