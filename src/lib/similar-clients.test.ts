import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SIMILAR_MATCHES,
  MIN_SIMILAR_CLIENTS,
  describeInsufficientData,
  describeSimilarity,
  findSimilarClients,
  isSimilarityReference,
  type SimilarInsufficientData,
  type SimilarityClient,
  type SimilarClientsResult,
} from "./similar-clients.ts";

// ---------------------------------------------------------------- fixtures

let nextId = 1;
function client(overrides: Partial<SimilarityClient> = {}): SimilarityClient {
  nextId += 1;
  return {
    id: `c${nextId}`,
    legal_name: `Client ${nextId}`,
    city: null,
    sector: null,
    total_income: null,
    financial_periods: null,
    outreach_status: "not_contacted",
    matched_grant_count: 0,
    priorityScore: 0.5,
    suppressionPending: false,
    ...overrides,
  };
}

/** A reference that clears the data gate: sector + size + converted outcome. */
const RICH_REFERENCE: SimilarityClient = {
  id: "ref",
  legal_name: "Reference Charity",
  city: "Sheffield",
  sector: "Youth & children's services",
  total_income: 250_000,
  outreach_status: "converted",
  matched_grant_count: 3,
  priorityScore: 0.6,
};

/** A candidate agreeing on every dimension the reference has. */
const TWIN: Partial<SimilarityClient> = {
  city: "Sheffield",
  sector: "Youth & children's services",
  total_income: 300_000,
  outreach_status: "converted",
  matched_grant_count: 2,
};

function twinsAround(reference: SimilarityClient, count: number): SimilarityClient[] {
  return Array.from({ length: count }, () => client({ ...TWIN, priorityScore: 0.55 }));
}

/** assert.equal doesn't narrow, so the copy checks go through this. */
function expectInsufficient<T extends SimilarityClient>(
  result: SimilarClientsResult<T>,
): SimilarInsufficientData {
  if (result.status !== "insufficient_data") {
    assert.fail(`expected insufficient_data, got ${result.status}`);
  }
  if (result.reason === null) {
    assert.fail("insufficient_data result carries no reason");
  }
  return {
    status: result.status,
    reason: result.reason,
    reference: result.reference,
    matches: result.matches,
  };
}

// ------------------------------------------------------------------- AC1

test("AC1: a converted reference qualifies; ordinary pipeline states do not", () => {
  assert.equal(isSimilarityReference("converted"), true);
  assert.equal(isSimilarityReference("future_potential"), true);
  assert.equal(isSimilarityReference("responded"), false);
  assert.equal(isSimilarityReference("no_response"), false);
  assert.equal(isSimilarityReference("initial_outreach_sent"), false);
  assert.equal(isSimilarityReference(null), false);
  assert.equal(isSimilarityReference(undefined), false);
});

test("AC1: the reference itself never appears among its own matches", () => {
  const candidates = [RICH_REFERENCE, ...twinsAround(RICH_REFERENCE, 4)];
  const result = findSimilarClients(RICH_REFERENCE, candidates);
  assert.equal(result.status, "ok");
  assert.ok(result.matches.every((match) => match.client.id !== "ref"));
});

// ------------------------------------------------------------------- AC2

test("AC2: agreement is on the scorers' states — same category/band/priority, not nearby numbers", () => {
  // The scorer factors are distinct but numerically close (Health 0.7,
  // Education 0.65). A threshold-based metric would call these similar;
  // state equality must not.
  const reference = client({
    sector: "Health & wellbeing",
    city: "Sheffield",
    total_income: 500_000,
    outreach_status: "converted",
    matched_grant_count: 1,
  });
  const candidates = [
    // Education & Youth (0.65): a *different* category, though numerically near.
    client({ ...TWIN, sector: "School", outreach_status: "future_potential" }),
    client({ ...TWIN, sector: "School", outreach_status: "future_potential" }),
    client({ ...TWIN, sector: "School", outreach_status: "future_potential" }),
  ];
  const result = findSimilarClients(reference, candidates);
  assert.equal(result.status, "ok");
  for (const match of result.matches) {
    const sector = match.sharedDimensions.find((d) => d.key === "sector");
    const outcome = match.sharedDimensions.find((d) => d.key === "pipeline");
    assert.equal(sector, undefined, "a different category must not agree on sector");
    assert.equal(outcome, undefined, "future_potential must not agree with converted");
    // Geography (priority) and size (over_1m) and grants still agree.
    assert.ok(match.sharedDimensions.length >= 2);
  }
});

test("AC2: explanations quote the shared state, and describeSimilarity renders a percentage", () => {
  const candidates = twinsAround(RICH_REFERENCE, 4);
  const result = findSimilarClients(RICH_REFERENCE, candidates);
  assert.equal(result.status, "ok");
  const best = result.matches[0];
  const sector = best.sharedDimensions.find((d) => d.key === "sector");
  assert.ok(sector);
  assert.equal(sector.description, "both work in Education & Youth");
  const size = best.sharedDimensions.find((d) => d.key === "size");
  assert.ok(size);
  assert.equal(size.description, "both sit in the Medium income band");
  const outcome = best.sharedDimensions.find((d) => d.key === "pipeline");
  assert.ok(outcome);
  assert.equal(outcome.description, "both converted");
  assert.match(describeSimilarity(best), /^100% — both work in /);
});

test("AC2: outcome agreement never claims converted for future_potential", () => {
  const reference = { ...RICH_REFERENCE, outreach_status: "future_potential" };
  const candidates = twinsAround(reference, 4).map((row) => ({
    ...row,
    outreach_status: "future_potential",
  }));
  const result = findSimilarClients(reference, candidates);
  assert.equal(result.status, "ok");
  const outcome = result.matches[0].sharedDimensions.find((d) => d.key === "pipeline");
  assert.ok(outcome);
  assert.equal(outcome.description, "both previously marked future potential");
});

// ------------------------------------------------------------------- AC3

test("AC3: a reference with no readable dimensions is insufficient, with a reason", () => {
  const blank = client({ outreach_status: "converted" }); // no sector/city/income/grants
  const result = findSimilarClients(blank, twinsAround(blank, 5));
  assert.equal(result.status, "insufficient_data");
  assert.equal(result.reason, "reference_undescribed");
  assert.deepEqual(result.matches, []);
  assert.equal(result.reference.knownDimensions.length, 1); // pipeline only
  const copy = describeInsufficientData(expectInsufficient(result));
  assert.match(copy, /at least 2/);
});

test("AC3: a reference one dimension short of the gate is insufficient", () => {
  // City + converted = geography + pipeline = 2 known dimensions, exactly at
  // the gate; drop the city and only pipeline remains.
  const thin = client({ outreach_status: "converted" });
  const result = findSimilarClients(thin, twinsAround(thin, 5));
  assert.equal(result.status, "insufficient_data");
});

test("AC3: fewer than three agreeing candidates is insufficient_data, not a short list", () => {
  // Two full twins plus one candidate agreeing on nothing at all: two matches
  // is under the gate, and the non-matcher must not be stretched to reach it.
  const candidates = [
    ...twinsAround(RICH_REFERENCE, MIN_SIMILAR_CLIENTS - 1),
    client({ sector: "Museum", city: "Leeds", total_income: 5_000, outreach_status: "hard_no" }),
  ];
  const result = findSimilarClients(RICH_REFERENCE, candidates);
  assert.equal(result.status, "insufficient_data");
  assert.equal(result.reason, "too_few_matches");
  assert.deepEqual(result.matches, []);
  const copy = describeInsufficientData(expectInsufficient(result));
  assert.match(copy, /Not enough data to find similar clients yet/);
});

test("AC3: suppressed candidates never surface as matches", () => {
  const candidates = twinsAround(RICH_REFERENCE, 5).map((row, index) => ({
    ...row,
    suppressionPending: index === 0,
  }));
  const result = findSimilarClients(RICH_REFERENCE, candidates);
  assert.equal(result.status, "ok");
  assert.ok(result.matches.every((match) => !match.client.suppressionPending));
});

// ------------------------------------------------- ranking, limits, edges

test("candidates agreeing on more dimensions rank first", () => {
  const candidates = [
    // Agrees on sector+size+grants+geography but not outcome.
    client({ ...TWIN, outreach_status: "responded" }),
    // Agrees on all five.
    client(TWIN),
    client(TWIN),
    client(TWIN),
  ];
  const result = findSimilarClients(RICH_REFERENCE, candidates);
  assert.equal(result.status, "ok");
  assert.equal(result.matches[0].similarity, 1);
  assert.equal(result.matches[0].sharedDimensions.length, 5);
  // The partial matches still appear, ranked below.
  assert.equal(result.matches.length, 4);
  assert.ok(result.matches[3].similarity < 1);
});

test("equal similarity breaks ties by the persisted base score, then name", () => {
  const candidates = [
    client({ ...TWIN, priorityScore: 0.4, legal_name: "Zeta Charity" }),
    client({ ...TWIN, priorityScore: 0.9, legal_name: "Mid Charity" }),
    client({ ...TWIN, priorityScore: 0.9, legal_name: "Alpha Charity" }),
    client({ ...TWIN, priorityScore: 0.9, legal_name: "Beta Charity" }),
  ];
  const result = findSimilarClients(RICH_REFERENCE, candidates);
  assert.equal(result.matches[0].client.legal_name, "Alpha Charity");
  assert.equal(result.matches[1].client.legal_name, "Beta Charity");
  assert.equal(result.matches[2].client.legal_name, "Mid Charity");
  assert.equal(result.matches[3].client.legal_name, "Zeta Charity");
});

test("the match list is capped at MAX_SIMILAR_MATCHES", () => {
  const candidates = twinsAround(RICH_REFERENCE, MAX_SIMILAR_MATCHES + 5);
  const result = findSimilarClients(RICH_REFERENCE, candidates);
  assert.equal(result.status, "ok");
  assert.equal(result.matches.length, MAX_SIMILAR_MATCHES);
});

test("an explicit limit shrinks the list", () => {
  const candidates = twinsAround(RICH_REFERENCE, 8);
  const result = findSimilarClients(RICH_REFERENCE, candidates, { limit: 2 });
  assert.equal(result.matches.length, 2);
});

test("candidates agreeing on nothing are simply absent", () => {
  const candidates = [
    ...twinsAround(RICH_REFERENCE, 4),
    client({ sector: "Museum", city: "Leeds", total_income: 5_000, outreach_status: "hard_no" }),
  ];
  const result = findSimilarClients(RICH_REFERENCE, candidates);
  assert.equal(result.status, "ok");
  assert.ok(result.matches.every((match) => match.client.sector !== "Museum"));
});

test("geography with no configured priority areas never manufactures agreement", () => {
  // BRANCH_PRIORITY_REGIONS includes Sheffield; passing an empty region list
  // puts every location at "no preference set" — a state nobody can agree on.
  const candidates = twinsAround(RICH_REFERENCE, 4);
  const result = findSimilarClients(RICH_REFERENCE, candidates, { priorityRegions: [] });
  assert.equal(result.status, "ok");
  for (const match of result.matches) {
    assert.equal(
      match.sharedDimensions.find((d) => d.key === "geography"),
      undefined,
    );
  }
});

test("a candidate with unknown size does not agree on size", () => {
  const candidates = twinsAround(RICH_REFERENCE, 4).map((row) => ({
    ...row,
    total_income: null,
    financial_periods: null,
  }));
  const result = findSimilarClients(RICH_REFERENCE, candidates);
  assert.equal(result.status, "ok");
  for (const match of result.matches) {
    assert.equal(match.sharedDimensions.find((d) => d.key === "size"), undefined);
    // Similarity denominators stay the reference's known dimensions.
    assert.equal(match.similarity, 4 / 5);
  }
});

test("invalid or empty input degrades honestly: no candidates means insufficient data", () => {
  const result = expectInsufficient(findSimilarClients(RICH_REFERENCE, []));
  assert.equal(result.reason, "too_few_matches");
  assert.deepEqual(result.matches, []);
});

test("financial_periods feed the size dimension like the list's own derivation", () => {
  const viaPeriods = client({
    ...TWIN,
    total_income: null,
    financial_periods: [{ total_income: 250_000, period_end: "2026-03-31" }],
  });
  const candidates = [viaPeriods, ...twinsAround(RICH_REFERENCE, 3)];
  const result = findSimilarClients(RICH_REFERENCE, candidates);
  assert.equal(result.status, "ok");
  const match = result.matches.find((m) => m.client.id === viaPeriods.id);
  assert.ok(match);
  assert.ok(match.sharedDimensions.some((d) => d.key === "size"));
});
