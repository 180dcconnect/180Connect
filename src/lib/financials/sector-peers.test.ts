import assert from "node:assert/strict";
import test from "node:test";

import {
  logPosition,
  MIN_PEERS_FOR_PERCENTILE,
  sectorPeerStatsFromDistribution,
  type SectorDistributionRow,
} from "./sector-peers.ts";

/** A distribution row shaped like the RPC's, with overridable fields. */
function row(over: Partial<SectorDistributionRow> = {}): SectorDistributionRow {
  return {
    peer_count: 200,
    min_income: 100_000,
    p25_income: 216_503,
    median_income: 532_572,
    p75_income: 1_116_886.5,
    max_income: 123_706_829,
    smaller_count: 100,
    ...over,
  };
}

test("derives the percentile from the RPC's own smaller-count", () => {
  const stats = sectorPeerStatsFromDistribution(
    row({ peer_count: 247, smaller_count: 233 }),
    8_370_918,
  );
  assert.equal(stats.peerCount, 247);
  assert.ok(Math.abs(stats.percentile! - 233 / 247) < 1e-9);
});

test("refuses a percentile under the small-n guard but still reports shape", () => {
  const stats = sectorPeerStatsFromDistribution(
    row({ peer_count: MIN_PEERS_FOR_PERCENTILE - 1, smaller_count: 3 }),
    500_000,
  );
  assert.equal(stats.percentile, null);
  assert.equal(stats.peerCount, MIN_PEERS_FOR_PERCENTILE - 1);
  assert.ok(stats.quartiles, "quartiles survive the guard — only the percentile is withheld");
});

test("gives a percentile exactly at the guard", () => {
  const stats = sectorPeerStatsFromDistribution(
    row({ peer_count: MIN_PEERS_FOR_PERCENTILE, smaller_count: MIN_PEERS_FOR_PERCENTILE }),
    9_000_000,
  );
  assert.equal(stats.percentile, 1);
});

test("a client with no income figure gets shape but no percentile", () => {
  // The RPC returns smaller_count 0 when handed a null income; that must not
  // render as a truthful-looking "larger than 0% of peers".
  const stats = sectorPeerStatsFromDistribution(row({ smaller_count: 0 }), null);
  assert.equal(stats.percentile, null);
  assert.equal(stats.peerCount, 200);
  assert.equal(stats.quartiles?.median, 532_572);
});

test("a genuine zero smaller-count is still a real 0th percentile", () => {
  const stats = sectorPeerStatsFromDistribution(row({ smaller_count: 0 }), 50_000);
  assert.equal(stats.percentile, 0, "distinct from the no-figure case above");
});

test("parses numeric-as-string, which is how some drivers return numeric", () => {
  const stats = sectorPeerStatsFromDistribution(
    row({
      peer_count: "247",
      min_income: "100354",
      p25_income: "216503",
      median_income: "532572",
      p75_income: "1116886.5",
      max_income: "123706829",
      smaller_count: "233",
    }),
    8_370_918,
  );
  assert.equal(stats.peerCount, 247);
  assert.equal(stats.quartiles?.max, 123_706_829);
  assert.equal(typeof stats.quartiles?.median, "number");
  assert.ok(Math.abs(stats.percentile! - 233 / 247) < 1e-9);
});

test("an empty sector reports nothing rather than a zeroed shape", () => {
  const empty = sectorPeerStatsFromDistribution(
    {
      peer_count: 0,
      min_income: null,
      p25_income: null,
      median_income: null,
      p75_income: null,
      max_income: null,
      smaller_count: 0,
    },
    500_000,
  );
  assert.deepEqual(empty, { peerCount: 0, percentile: null, quartiles: null });
});

test("a missing row is not a crash", () => {
  assert.deepEqual(sectorPeerStatsFromDistribution(null, 500_000), {
    peerCount: 0,
    percentile: null,
    quartiles: null,
  });
  assert.deepEqual(sectorPeerStatsFromDistribution(undefined, null), {
    peerCount: 0,
    percentile: null,
    quartiles: null,
  });
});

test("a partial shape is refused whole rather than drawn with a guessed edge", () => {
  const stats = sectorPeerStatsFromDistribution(row({ p75_income: null }), 500_000);
  assert.equal(stats.quartiles, null);
  assert.equal(stats.peerCount, 200, "the count still stands — only the box is undrawable");
});

test("logPosition spreads decades evenly and clamps outside the bounds", () => {
  assert.equal(logPosition(1_000, 1_000, 1_000_000), 0);
  assert.equal(logPosition(1_000_000, 1_000, 1_000_000), 1);
  // 10^4.5 is the midpoint of a three-decade span.
  assert.ok(Math.abs(logPosition(31_622.7, 1_000, 1_000_000) - 0.5) < 0.001);
  assert.equal(logPosition(1, 1_000, 1_000_000), 0, "below the floor clamps, never -Infinity");
  assert.equal(logPosition(0, 1_000, 1_000_000), 0);
  assert.equal(logPosition(9_000_000, 1_000, 1_000_000), 1);
});

test("logPosition survives a degenerate range", () => {
  const position = logPosition(500, 500, 500);
  assert.ok(Number.isFinite(position));
  assert.ok(position >= 0 && position <= 1);
});

test("log scale is what makes a skewed sector legible", () => {
  // Health & Social Care on staging: £100k to £124m, median £533k. On a linear
  // axis the median sits at 0.4% of the track; the point of the log scale is
  // that it lands somewhere a reader can see.
  const linear = (532_572 - 100_354) / (123_706_829 - 100_354);
  const log = logPosition(532_572, 100_354, 123_706_829);
  assert.ok(linear < 0.005, `linear placement is ${linear}`);
  assert.ok(log > 0.2 && log < 0.3, `log placement is ${log}`);
});
