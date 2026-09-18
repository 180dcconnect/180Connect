import assert from "node:assert/strict";
import test from "node:test";

import { chunkIds, mapPool } from "./coverage-reads.ts";

test("chunkIds keeps each PostgREST-safe batch in its original order", () => {
  assert.deepEqual(chunkIds(["a", "b", "c", "d", "e"], 2), [
    ["a", "b"],
    ["c", "d"],
    ["e"],
  ]);
});

test("mapPool bounds concurrent reads and preserves their input order", async () => {
  let active = 0;
  let peak = 0;

  const result = await mapPool(
    [1, 2, 3, 4, 5],
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return value * 10;
    },
    2,
  );

  assert.equal(peak, 2);
  assert.deepEqual(result, [10, 20, 30, 40, 50]);
});
