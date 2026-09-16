import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  interpolatePriorityColor,
  PRIORITY_ZONE_COLOURS,
  PRIORITY_ZONE_SPANS,
  priorityZoneOf,
} from "./priority-scale.ts";

describe("priorityZoneOf", () => {
  it("cuts the scale at 0.20 / 0.40 / 0.55 / 0.70 / 0.85", () => {
    assert.equal(priorityZoneOf(0), "critical_low");
    assert.equal(priorityZoneOf(0.199), "critical_low");
    assert.equal(priorityZoneOf(0.2), "low");
    assert.equal(priorityZoneOf(0.4), "low_medium");
    assert.equal(priorityZoneOf(0.55), "high_medium");
    assert.equal(priorityZoneOf(0.7), "high");
    assert.equal(priorityZoneOf(0.85), "extremely_high");
    assert.equal(priorityZoneOf(1), "extremely_high");
  });

  it("agrees with the zone spans", () => {
    for (const [zone, span] of Object.entries(PRIORITY_ZONE_SPANS)) {
      assert.equal(priorityZoneOf(span.from), zone);
    }
  });
});

describe("interpolatePriorityColor", () => {
  it("hits the brick and emerald endpoints exactly", () => {
    assert.equal(interpolatePriorityColor(0), "rgb(140, 58, 43)");
    assert.equal(interpolatePriorityColor(1), "rgb(32, 74, 62)");
  });

  it("clamps outside 0–1", () => {
    assert.equal(interpolatePriorityColor(-0.5), interpolatePriorityColor(0));
    assert.equal(interpolatePriorityColor(1.5), interpolatePriorityColor(1));
  });
});

describe("PRIORITY_ZONE_COLOURS", () => {
  it("covers every zone with the record gauge's inks", () => {
    assert.deepEqual(PRIORITY_ZONE_COLOURS, {
      critical_low: "#8C3A2B",
      low: "#B05840",
      low_medium: "#D97D38",
      high_medium: "#DCA524",
      high: "#356B58",
      extremely_high: "#204A3E",
    });
  });
});
