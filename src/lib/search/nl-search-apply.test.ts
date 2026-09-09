import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  visibleClients,
  type ClientListRow,
  type VisibleClient,
} from "../../app/clients/visible-clients.ts";
import {
  applyNlPlan,
  filterByIncomeBands,
  rankByPlan,
  resolveNlPlan,
  resolvedPlanIsEmpty,
  type ResolvedNlPlan,
} from "./nl-search-apply.ts";
import { EMPTY_PLAN } from "./nl-search-plan.ts";

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

const clients = (rows: ClientListRow[]): VisibleClient[] => visibleClients(rows, []);

const resolved = (overrides: Partial<ResolvedNlPlan> = {}): ResolvedNlPlan => ({
  ...EMPTY_PLAN,
  dropped: [],
  ...overrides,
});

describe("resolveNlPlan", () => {
  it("keeps a city the list actually holds", () => {
    const plan = resolveNlPlan({ ...EMPTY_PLAN, cities: ["Leeds"] }, ["Leeds", "Bristol"], ["GB"]);
    assert.deepEqual(plan.cities, ["Leeds"]);
    assert.deepEqual(plan.dropped, []);
  });

  it("drops a city nothing is in, rather than filtering the list to nothing", () => {
    // AC2 at its most literal: the model can name any place it likes and no row
    // appears that was not already in the database.
    const plan = resolveNlPlan({ ...EMPTY_PLAN, cities: ["Atlantis"] }, ["Leeds"], ["GB"]);
    assert.deepEqual(plan.cities, []);
    assert.deepEqual(plan.dropped, ["Atlantis"]);
  });

  it("matches a place written more than one way in register data", () => {
    const plan = resolveNlPlan({ ...EMPTY_PLAN, cities: ["Leeds"] }, ["Leeds City", "Leeds"], ["GB"]);
    assert.deepEqual(plan.cities.sort(), ["Leeds"]);
  });

  it("does not let a short city name match a longer unrelated one", () => {
    const plan = resolveNlPlan({ ...EMPTY_PLAN, cities: ["Bath"] }, ["Bathgate"], ["GB"]);
    assert.deepEqual(plan.cities, []);
  });

  it("turns a country name into the ISO code the column stores", () => {
    const plan = resolveNlPlan({ ...EMPTY_PLAN, countries: ["Ireland"] }, [], ["GB", "IE"]);
    assert.deepEqual(plan.countries, ["IE"]);
  });

  it("drops a country the list holds nobody in", () => {
    const plan = resolveNlPlan({ ...EMPTY_PLAN, countries: ["France"] }, [], ["GB"]);
    assert.deepEqual(plan.countries, []);
    assert.deepEqual(plan.dropped, ["France"]);
  });
});

describe("resolvedPlanIsEmpty", () => {
  it("ignores commentary fields", () => {
    assert.equal(resolvedPlanIsEmpty(resolved({ dropped: ["Atlantis"], unsupported: ["x"] })), true);
    assert.equal(resolvedPlanIsEmpty(resolved({ sectors: ["health"] })), false);
  });
});

describe("filterByIncomeBands", () => {
  const rows = clients([
    org({ id: "small", income_band: "10k_100k" }),
    org({ id: "large", income_band: "over_1m" }),
    org({ id: "unknown" }),
  ]);

  it("keeps the asked-for band", () => {
    const kept = filterByIncomeBands(rows, ["10k_100k"]).map((c) => c.id);
    assert.ok(kept.includes("small"));
    assert.ok(!kept.includes("large"));
  });

  it("keeps a client whose income is unknown", () => {
    // Charity Commission income is patchy; dropping every unfiled organisation
    // on the word "small" would hide exactly the charities it was reaching for.
    assert.ok(filterByIncomeBands(rows, ["10k_100k"]).some((c) => c.id === "unknown"));
  });

  it("filters nothing when no band was asked for", () => {
    assert.equal(filterByIncomeBands(rows, []).length, 3);
  });
});

describe("rankByPlan", () => {
  it("puts more keyword matches first", () => {
    const rows = clients([
      org({ id: "a", legal_name: "General Trust" }),
      org({ id: "b", legal_name: "Leeds Literacy Project", sector: "education" }),
    ]);
    const ranked = rankByPlan(rows, resolved({ keywords: ["literacy"] }));
    assert.equal(ranked[0].id, "b");
  });

  it("breaks ties on priority score, not database order", () => {
    // AC4: two equally relevant charities come back best-prospect-first.
    const rows = clients([
      org({ id: "low", latest_scores: { priority_score: 0.2, priority_band: "low", scored_at: null } }),
      org({ id: "high", latest_scores: { priority_score: 0.9, priority_band: "high", scored_at: null } }),
    ]);
    assert.deepEqual(rankByPlan(rows, resolved()).map((c) => c.id), ["high", "low"]);
  });

  it("orders by name when relevance and score are equal, so pages never repeat a client", () => {
    const rows = clients([
      org({ id: "b", legal_name: "Beta Trust" }),
      org({ id: "a", legal_name: "Alpha Trust" }),
    ]);
    assert.deepEqual(rankByPlan(rows, resolved()).map((c) => c.id), ["a", "b"]);
  });

  it("ranks a confirmed size match above an unknown one", () => {
    const rows = clients([
      org({ id: "unknown", legal_name: "A Charity" }),
      org({ id: "confirmed", legal_name: "B Charity", income_band: "10k_100k" }),
    ]);
    const ranked = rankByPlan(rows, resolved({ incomeBands: ["10k_100k"] }));
    assert.equal(ranked[0].id, "confirmed");
  });

  it("does not mutate the array it was given", () => {
    const rows = clients([org({ id: "b", legal_name: "B" }), org({ id: "a", legal_name: "A" })]);
    rankByPlan(rows, resolved());
    assert.equal(rows[0].id, "b");
  });
});

describe("applyNlPlan", () => {
  const rows = clients([
    org({ id: "leeds-edu", legal_name: "Leeds Learning Trust", city: "Leeds", sector: "education" }),
    org({ id: "leeds-health", legal_name: "Leeds Health Centre", city: "Leeds", sector: "health" }),
    org({ id: "bristol-edu", legal_name: "Bristol Schools Fund", city: "Bristol", sector: "education" }),
  ]);

  it("narrows on every hard filter at once", () => {
    const result = applyNlPlan(rows, resolved({ cities: ["Leeds"], sectors: ["education"] }));
    assert.deepEqual(result.map((c) => c.id), ["leeds-edu"]);
  });

  it("returns nothing when the question genuinely matches nothing", () => {
    // The no-results case from the ticket's testing notes: an honest empty list,
    // not a widened one that pretends to have found something.
    const result = applyNlPlan(rows, resolved({ cities: ["Leeds"], sectors: ["arts"] }));
    assert.deepEqual(result, []);
  });

  it("never narrows on keywords — they only reorder", () => {
    // A description is not a boolean expression: "youth music project" should
    // surface the closest matches, not return nothing because no legal_name
    // contains "music".
    const result = applyNlPlan(rows, resolved({ keywords: ["music"] }));
    assert.equal(result.length, 3);
  });
});
