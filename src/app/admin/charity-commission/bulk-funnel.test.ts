import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bulkFunnel, discoveryReach, formatCount } from "./bulk-funnel.ts";

const full = {
  charitiesScanned: 185_574,
  registered: 140_000,
  passedIncome: 30_000,
  passedSector: 9_000,
  accepted: 4_704,
  annualReturnRows: 20_000,
};

describe("bulkFunnel", () => {
  it("returns one stage per gate, in the order the adapter applies them", () => {
    const stages = bulkFunnel(full)!;
    assert.deepEqual(
      stages.map((stage) => stage.key),
      ["charitiesScanned", "registered", "passedIncome", "passedSector", "accepted"],
    );
    assert.deepEqual(
      stages.map((stage) => stage.value),
      [185_574, 140_000, 30_000, 9_000, 4_704],
    );
  });

  it("measures each share against the first stage, not the previous one", () => {
    const stages = bulkFunnel(full)!;
    assert.equal(stages[0].share, 100);
    assert.ok(Math.abs(stages[4].share - (4_704 / 185_574) * 100) < 1e-9);
  });

  it("reports what each gate removed", () => {
    const stages = bulkFunnel(full)!;
    assert.equal(stages[0].dropped, null);
    assert.equal(stages[1].dropped, 185_574 - 140_000);
    assert.equal(stages[4].dropped, 9_000 - 4_704);
  });

  it("returns null for a run that recorded no stats", () => {
    assert.equal(bulkFunnel(null), null);
    assert.equal(bulkFunnel(undefined), null);
  });

  it("returns null rather than half a funnel when a stage is missing", () => {
    // A partly-drawn funnel invites the reader to infer a drop that never
    // happened — better to say nothing was recorded.
    const { passedSector: _omitted, ...missing } = full;
    void _omitted;
    assert.equal(bulkFunnel(missing), null);
  });

  it("ignores stage values that are not usable counts", () => {
    assert.equal(bulkFunnel({ ...full, accepted: -1 }), null);
    assert.equal(bulkFunnel({ ...full, accepted: "4704" }), null);
    assert.equal(bulkFunnel({ ...full, accepted: Number.NaN }), null);
  });

  it("keeps every bar empty rather than dividing by zero", () => {
    const stages = bulkFunnel({
      charitiesScanned: 0,
      registered: 0,
      passedIncome: 0,
      passedSector: 0,
      accepted: 0,
    })!;
    assert.ok(stages.every((stage) => stage.share === 0));
  });
});

describe("discoveryReach", () => {
  it("reads the discovery job's national and local counts", () => {
    assert.deepEqual(discoveryReach({ registeredNationally: 342, local: 11 }), {
      registeredNationally: 342,
      local: 11,
    });
  });

  it("returns null for a bulk run's stats, which carry neither key", () => {
    assert.equal(discoveryReach(full), null);
  });

  it("returns null for a run that recorded no stats", () => {
    assert.equal(discoveryReach(null), null);
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    assert.equal(formatCount(185_574), "185,574");
    assert.equal(formatCount(0), "0");
  });
});
