import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterTeamPipelineClients,
  ownerOptions,
  paginateTeamPipelineClients,
  parseTeamPipelineFilters,
  pipelineCounts,
  sortTeamPipelineClients,
  UNASSIGNED_OWNER,
  type TeamPipelineClient,
} from "./team-pipeline.ts";

function client(overrides: Partial<TeamPipelineClient> = {}): TeamPipelineClient {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    legal_name: "Charity A",
    outreach_status: "not_contacted",
    owner_id: null,
    owner_name: null,
    ...overrides,
  };
}

const CAM_A = "11111111-1111-4111-8111-111111111111";
const CAM_B = "22222222-2222-4222-8222-222222222222";

const rows: TeamPipelineClient[] = [
  client({ id: "a", legal_name: "Alpha Trust", outreach_status: "responded", owner_id: CAM_A, owner_name: "Alice" }),
  client({ id: "b", legal_name: "Beta Fund", outreach_status: "not_contacted" }),
  client({ id: "c", legal_name: "Gamma CIC", outreach_status: "soft_no", owner_id: CAM_B, owner_name: "Bob" }),
  client({ id: "d", legal_name: "Alpha Two", outreach_status: "converted", owner_id: CAM_A, owner_name: "Alice" }),
];

describe("pipelineCounts", () => {
  it("counts every client into its stage and sums to the total", () => {
    const counts = pipelineCounts(rows);
    assert.equal(counts.reduce((total, entry) => total + entry.count, 0), rows.length);
    const byStatus = new Map(counts.map((entry) => [entry.status, entry.count]));
    assert.equal(byStatus.get("responded"), 1);
    assert.equal(byStatus.get("not_contacted"), 1);
    assert.equal(byStatus.get("soft_no"), 1);
    assert.equal(byStatus.get("converted"), 1);
  });

  it("orders the stages in canonical pipeline order", () => {
    const mixed: TeamPipelineClient[] = [
      client({ outreach_status: "hard_no" }),
      client({ outreach_status: "initial_outreach_sent" }),
      client({ outreach_status: "not_contacted" }),
    ];
    const statuses = pipelineCounts(mixed).map((entry) => entry.status);
    assert.deepEqual(statuses, ["not_contacted", "initial_outreach_sent", "hard_no"]);
  });

  it("returns an empty list for an empty team", () => {
    assert.deepEqual(pipelineCounts([]), []);
  });
});

describe("filterTeamPipelineClients", () => {
  it("keeps everything when no filters are set", () => {
    assert.equal(
      filterTeamPipelineClients(rows, { q: "", statuses: [], owners: [] }).length,
      rows.length,
    );
  });

  it("matches free text against the client name, case-insensitively", () => {
    const filtered = filterTeamPipelineClients(rows, { q: "ALPHA", statuses: [], owners: [] });
    assert.deepEqual(filtered.map((row) => row.id).sort(), ["a", "d"]);
  });

  it("filters by one or more pipeline statuses", () => {
    const filtered = filterTeamPipelineClients(rows, {
      q: "",
      statuses: ["responded", "converted"],
      owners: [],
    });
    assert.deepEqual(filtered.map((row) => row.id).sort(), ["a", "d"]);
  });

  it("filters by owning CAM", () => {
    const filtered = filterTeamPipelineClients(rows, { q: "", statuses: [], owners: [CAM_B] });
    assert.deepEqual(filtered.map((row) => row.id), ["c"]);
  });

  it('includes unowned clients when the "unassigned" sentinel is chosen', () => {
    const filtered = filterTeamPipelineClients(rows, {
      q: "",
      statuses: [],
      owners: [UNASSIGNED_OWNER],
    });
    assert.deepEqual(filtered.map((row) => row.id), ["b"]);
  });

  it("combines a CAM filter with the unassigned pool", () => {
    const filtered = filterTeamPipelineClients(rows, {
      q: "",
      statuses: [],
      owners: [CAM_A, UNASSIGNED_OWNER],
    });
    assert.deepEqual(filtered.map((row) => row.id).sort(), ["a", "b", "d"]);
  });

  it("applies all filters together", () => {
    const filtered = filterTeamPipelineClients(rows, {
      q: "alpha",
      statuses: ["converted"],
      owners: [CAM_A],
    });
    assert.deepEqual(filtered.map((row) => row.id), ["d"]);
  });
});

describe("sortTeamPipelineClients", () => {
  it("sorts alphabetically by name without mutating the input", () => {
    const unsorted = [
      client({ id: "z", legal_name: "Zeta" }),
      client({ id: "m", legal_name: "Midway" }),
    ];
    const sorted = sortTeamPipelineClients(unsorted);
    assert.deepEqual(sorted.map((row) => row.id), ["m", "z"]);
    assert.equal(unsorted[0].id, "z");
  });

  it("breaks ties on id so equal names keep one order between requests", () => {
    const tied = [client({ id: "b2", legal_name: "Same Name" }), client({ id: "a1", legal_name: "Same Name" })];
    assert.deepEqual(sortTeamPipelineClients(tied).map((row) => row.id), ["a1", "b2"]);
  });
});

describe("paginateTeamPipelineClients", () => {
  const fiftyOne = Array.from({ length: 51 }, (_, index) => client({ id: String(index) }));

  it("slices the requested page at the page size", () => {
    const result = paginateTeamPipelineClients(fiftyOne, 1);
    assert.equal(result.rows.length, 50);
    assert.equal(result.pageCount, 2);
    assert.equal(result.total, 51);
  });

  it("serves the short final page", () => {
    const result = paginateTeamPipelineClients(fiftyOne, 2);
    assert.equal(result.rows.length, 1);
  });

  it("clamps a page past the end back to the last real page", () => {
    const result = paginateTeamPipelineClients(fiftyOne, 99);
    assert.equal(result.page, 2);
    assert.equal(result.rows.length, 1);
  });

  it("clamps to page 1 and never divides by zero on an empty list", () => {
    const empty = paginateTeamPipelineClients([], 3);
    assert.deepEqual(empty, { rows: [], page: 1, pageCount: 1, total: 0 });
  });
});

describe("ownerOptions", () => {
  it("lists each owning CAM once with their name, sorted by name", () => {
    assert.deepEqual(ownerOptions(rows), [
      { id: CAM_A, name: "Alice" },
      { id: CAM_B, name: "Bob" },
    ]);
  });

  it("never offers someone who owns nothing", () => {
    const withIdleCam = [...rows, client({ owner_id: undefined, owner_name: undefined })];
    assert.equal(ownerOptions(withIdleCam.filter((r) => r.owner_id !== null)).length, 2);
  });

  it("falls back to the id when an owner has no usable name", () => {
    const unnamed = [client({ owner_id: CAM_A, owner_name: null })];
    assert.deepEqual(ownerOptions(unnamed), [{ id: CAM_A, name: CAM_A }]);
  });
});

describe("parseTeamPipelineFilters", () => {
  it("reads single values", () => {
    const parsed = parseTeamPipelineFilters({ status: "responded", owner: CAM_A, q: " alpha ", page: "2" });
    assert.deepEqual(parsed.filters, { q: "alpha", statuses: ["responded"], owners: [CAM_A] });
    assert.equal(parsed.page, 2);
  });

  it("reads repeated params as multi-select (the search bar appends)", () => {
    const parsed = parseTeamPipelineFilters({
      status: ["responded", "converted"],
      owner: [CAM_A, UNASSIGNED_OWNER],
    });
    assert.deepEqual(parsed.filters.statuses.sort(), ["converted", "responded"]);
    assert.deepEqual(parsed.filters.owners, [CAM_A, UNASSIGNED_OWNER]);
  });

  it("drops unknown statuses, non-uuid owners and junk pages instead of erroring", () => {
    const parsed = parseTeamPipelineFilters({
      status: ["responded", "made_up_stage"],
      owner: ["not-a-uuid", CAM_B],
      page: "not-a-number",
    });
    assert.deepEqual(parsed.filters.statuses, ["responded"]);
    assert.deepEqual(parsed.filters.owners, [CAM_B]);
    assert.equal(parsed.page, 1);
  });

  it("treats missing params as no filters", () => {
    assert.deepEqual(parseTeamPipelineFilters({}), {
      filters: { q: "", statuses: [], owners: [] },
      page: 1,
    });
  });
});
