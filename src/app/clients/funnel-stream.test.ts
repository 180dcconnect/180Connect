import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { funnelStream } from "./funnel-stream.ts";

describe("funnelStream", () => {
  it("draws one closed ribbon per stage", () => {
    const { ribbons } = funnelStream([100, 60, 30, 10]);
    assert.equal(ribbons.length, 4);
    for (const ribbon of ribbons) {
      assert.match(ribbon.path, /^M /);
      assert.match(ribbon.path, / Z$/);
      // Top curve, mirrored bottom curve, and the `L` that joins them.
      assert.equal(ribbon.path.split(" C ").length - 1, 10);
      assert.equal(ribbon.path.split(" L ").length - 1, 1);
    }
  });

  it("spaces the markers evenly inside the inset", () => {
    const { markers } = funnelStream([4, 3, 2, 1], { inset: 0.1 });
    assert.deepEqual(
      markers.map((value) => Math.round(value * 1000) / 1000),
      [0.1, 0.367, 0.633, 0.9],
    );
  });

  it("gives the outermost ribbon the full height at the first stage", () => {
    const { ribbons } = funnelStream([100, 50, 25, 5], { width: 1000, height: 260, padding: 10 });
    // Half the drawable height above the centre line: 130 - 10 = 120 → y = 10.
    assert.match(ribbons[0].path, /^M 0 10 /);
    // The innermost ribbon is 5/100 of that: 120 * 0.05 = 6 → y = 130 - 6 = 124.
    assert.match(ribbons[3].path, /^M 0 124 /);
  });

  it("collapses to the centre line rather than dividing by zero", () => {
    const { ribbons } = funnelStream([0, 0, 0, 0], { height: 260 });
    for (const ribbon of ribbons) assert.match(ribbon.path, /^M 0 130 /);
  });
});
