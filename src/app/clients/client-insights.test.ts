import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_BREAKDOWN_LIMIT,
  breakdown,
  breakdownLimit,
  clientsInStage,
  parseDirection,
  parseField,
  parseStage,
  pipelineFunnel,
} from "./client-insights.ts";
import { visibleClients, type ClientListRow } from "./visible-clients.ts";

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
    org_tags: [],
    ...overrides,
  };
}

/** Shapes raw rows the way the page does, so the tests exercise the real input. */
const shape = (rows: ClientListRow[]) => visibleClients(rows, []);

describe("pipelineFunnel", () => {
  it("narrows through the four stages", () => {
    const stages = pipelineFunnel(
      shape([
        org({ id: "a", outreach_status: "not_contacted" }),
        org({ id: "b", outreach_status: "initial_outreach_sent" }),
        org({ id: "c", outreach_status: "responded" }),
        org({ id: "d", outreach_status: "converted" }),
      ]),
    );

    assert.deepEqual(
      stages.map((stage) => [stage.key, stage.count]),
      [
        ["all", 4],
        ["contacted", 3],
        ["responded", 2],
        ["converted", 1],
      ],
    );
  });

  it("reports each stage against the total and against the stage above it", () => {
    const stages = pipelineFunnel(
      shape([
        org({ id: "a", outreach_status: "not_contacted" }),
        org({ id: "b", outreach_status: "not_contacted" }),
        org({ id: "c", outreach_status: "responded" }),
        org({ id: "d", outreach_status: "converted" }),
      ]),
    );

    assert.equal(stages[0].shareOfPrevious, null);
    assert.equal(stages[1].shareOfTotal, 0.5);
    assert.equal(stages[2].shareOfPrevious, 1);
    assert.equal(stages[3].shareOfPrevious, 0.5);
  });

  it("draws an empty funnel rather than dividing by zero", () => {
    for (const stage of pipelineFunnel([])) {
      assert.equal(stage.count, 0);
      assert.equal(stage.shareOfTotal, 0);
    }
  });
});

describe("clientsInStage", () => {
  it("keeps everything on the first stage", () => {
    const clients = shape([org({ id: "a" }), org({ id: "b", outreach_status: "converted" })]);
    assert.equal(clientsInStage(clients, "all").length, 2);
    assert.equal(clientsInStage(clients, "converted").length, 1);
  });
});

describe("breakdown", () => {
  const clients = shape([
    org({ id: "1", city: "London", outreach_status: "converted" }),
    org({ id: "2", city: "London", outreach_status: "not_contacted" }),
    org({ id: "3", city: "London", outreach_status: "not_contacted" }),
    org({ id: "4", city: "Leeds", outreach_status: "converted" }),
    org({ id: "5", city: "Leeds", outreach_status: "not_contacted" }),
    org({ id: "6", city: "Bath", outreach_status: "not_contacted" }),
    org({ id: "7", city: null, outreach_status: "not_contacted" }),
  ]);

  it("returns the biggest groups first, limited", () => {
    assert.deepEqual(
      breakdown(clients, "city").map((row) => [row.label, row.count]),
      [
        ["London", 3],
        ["Leeds", 2],
        ["Bath", 1],
      ],
    );
  });

  it("flips to the smallest groups on ascending", () => {
    assert.deepEqual(
      breakdown(clients, "city", "ascending").map((row) => row.label),
      ["Bath", "No city recorded", "Leeds"],
    );
  });

  it("scales the bars against the biggest group shown", () => {
    const rows = breakdown(clients, "city", "descending", "all", 2);
    assert.deepEqual(
      rows.map((row) => row.share),
      [1, 2 / 3],
    );
  });

  it("carries every stage's count for each group", () => {
    const london = breakdown(clients, "city")[0];
    assert.equal(london.label, "London");
    assert.deepEqual(london.counts, { all: 3, contacted: 1, responded: 1, converted: 1 });
  });

  it("ranks by the chosen stage, not always by the total", () => {
    const busy = shape([
      org({ id: "1", city: "London", outreach_status: "not_contacted" }),
      org({ id: "2", city: "London", outreach_status: "not_contacted" }),
      org({ id: "3", city: "London", outreach_status: "not_contacted" }),
      org({ id: "4", city: "Leeds", outreach_status: "converted" }),
      org({ id: "5", city: "Leeds", outreach_status: "converted" }),
    ]);
    assert.equal(breakdown(busy, "city", "descending", "all")[0].label, "London");
    assert.equal(breakdown(busy, "city", "descending", "converted")[0].label, "Leeds");
  });

  it("counts clients with no city as their own unfilterable group", () => {
    const row = breakdown(clients, "city", "descending", "all", 10).find(
      (entry) => entry.label === "No city recorded",
    );
    assert.equal(row?.count, 1);
    assert.equal(row?.filter, null);
  });

  it("names the list filter each group corresponds to", () => {
    assert.deepEqual(breakdown(clients, "city")[0].filter, { param: "city", value: "London" });
    // F053: the link carries the stored organisation_type, not its label — the
    // filter matches on the enum, so a label here would find nothing.
    assert.deepEqual(breakdown(clients, "type")[0].filter, {
      param: "type",
      value: "charity",
    });
    assert.deepEqual(breakdown(clients, "owner")[0].filter, {
      param: "owner",
      value: "unassigned",
    });
  });

  it("groups a stage's clients only, when handed one", () => {
    assert.deepEqual(
      breakdown(clientsInStage(clients, "converted"), "city").map((row) => [row.label, row.count]),
      [
        ["Leeds", 1],
        ["London", 1],
      ],
    );
  });

  it("breaks ties alphabetically", () => {
    const tied = shape([
      org({ id: "1", city: "York" }),
      org({ id: "2", city: "Acton" }),
    ]);
    assert.deepEqual(
      breakdown(tied, "city").map((row) => row.label),
      ["Acton", "York"],
    );
  });

  describe("team ownership breakdown (F167)", () => {
    const teamClients = shape([
      org({ id: "1", owner_id: "cam-1", owner: { full_name: "Sarah Jenkins" }, outreach_status: "converted" }),
      org({ id: "2", owner_id: "cam-1", owner: { full_name: "Sarah Jenkins" }, outreach_status: "initial_outreach_sent" }),
      org({ id: "3", owner_id: "cam-2", owner: { full_name: "Mohammed Saeed" }, outreach_status: "converted" }),
      org({ id: "4", owner_id: null, owner: null, outreach_status: "not_contacted" }),
      org({ id: "5", owner_id: null, owner: null, outreach_status: "not_contacted" }),
      org({ id: "6", owner_id: null, owner: null, outreach_status: "not_contacted" }),
    ]);

    it("groups clients by team owner and tracks unassigned accounts", () => {
      const rows = breakdown(teamClients, "owner", "descending", "all", 10);
      assert.deepEqual(
        rows.map((r) => [r.label, r.count]),
        [
          ["Unassigned", 3],
          ["Sarah Jenkins", 2],
          ["Mohammed Saeed", 1],
        ],
      );
    });

    it("calculates funnel stages per team member", () => {
      const sarah = breakdown(teamClients, "owner", "descending", "all", 10).find(
        (r) => r.label === "Sarah Jenkins",
      );
      assert.deepEqual(sarah?.counts, {
        all: 2,
        contacted: 2,
        responded: 1,
        converted: 1,
      });
    });

    it("keeps owners the CAM list does not contain, rather than truncating them", () => {
      // The limit is not the size of the team: an admin owner and a deactivated
      // former owner both hold clients without appearing in the CAM dropdown, and
      // F167 AC1 says an admin sees every client's owner in the one view.
      const mixed = shape([
        org({ id: "1", owner_id: "cam-1", owner: { full_name: "Sarah Jenkins" } }),
        org({ id: "2", owner_id: "cam-2", owner: { full_name: "Mohammed Saeed" } }),
        org({ id: "3", owner_id: "admin-1", owner: { full_name: "Bashir Bobboi" } }),
        // owner_id set, join empty — a deactivated member's row is hidden from `users`.
        org({ id: "4", owner_id: "former-1", owner: null }),
        org({ id: "5", owner_id: null, owner: null }),
      ]);

      const labels = breakdown(mixed, "owner", "descending", "all", breakdownLimit("owner")).map(
        (row) => row.label,
      );

      assert.deepEqual(labels.sort(), [
        "A former team member",
        "Bashir Bobboi",
        "Mohammed Saeed",
        "Sarah Jenkins",
        "Unassigned",
      ]);
    });

    it("links team owner groups to their specific filter", () => {
      const rows = breakdown(teamClients, "owner", "descending", "all", 10);
      const unassigned = rows.find((r) => r.label === "Unassigned");
      const sarah = rows.find((r) => r.label === "Sarah Jenkins");

      assert.deepEqual(unassigned?.filter, { param: "owner", value: "unassigned" });
      assert.deepEqual(sarah?.filter, { param: "owner", value: "cam-1" });
    });
  });
});

describe("breakdownLimit", () => {
  it("shows every group when grouped by owner", () => {
    assert.equal(breakdownLimit("owner"), Number.POSITIVE_INFINITY);
  });

  it("stays a top three for every other field", () => {
    for (const field of ["city", "type", "status"] as const) {
      assert.equal(breakdownLimit(field), DEFAULT_BREAKDOWN_LIMIT);
    }
  });
});

describe("parsing url state", () => {
  it("falls back when the parameter is missing or unknown", () => {
    assert.equal(parseStage(undefined), "all");
    assert.equal(parseStage("nonsense"), "all");
    assert.equal(parseStage("converted"), "converted");
    assert.equal(parseField(undefined), "city");
    assert.equal(parseField("owner"), "owner");
    assert.equal(parseDirection("ascending"), "ascending");
    assert.equal(parseDirection("sideways"), "descending");
  });
});
