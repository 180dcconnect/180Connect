import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chunk, fetchPaged, fetchPagedForOrgs, FETCH_STEP, ID_CHUNK } from "./fetch-paged.ts";

/** A source of `total` rows that answers range requests the way PostgREST does. */
const pageSource = (total: number) => {
  const calls: { from: number; to: number }[] = [];
  const build = (from: number, to: number) => {
    calls.push({ from, to });
    return Promise.resolve({
      data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i),
      error: null,
    });
  };
  return { build, calls };
};

describe("fetchPaged", () => {
  it("stops on the first short page", async () => {
    const source = pageSource(10);
    const { data, error } = await fetchPaged<number>(source.build);

    assert.equal(error, null);
    assert.equal(data?.length, 10);
    assert.equal(source.calls.length, 1);
  });

  it("walks past the 1000-row cap that a plain select would truncate at", async () => {
    const source = pageSource(FETCH_STEP * 2 + 7);
    const { data } = await fetchPaged<number>(source.build);

    assert.equal(data?.length, FETCH_STEP * 2 + 7);
    assert.deepEqual(
      source.calls.map((call) => call.from),
      [0, FETCH_STEP, FETCH_STEP * 2],
    );
    // Every window is exactly one step wide, so no row is fetched twice or skipped.
    for (const call of source.calls) assert.equal(call.to - call.from + 1, FETCH_STEP);
  });

  it("terminates on an exact multiple of the page size", async () => {
    const source = pageSource(FETCH_STEP);
    const { data } = await fetchPaged<number>(source.build);

    assert.equal(data?.length, FETCH_STEP);
    // The second call is what proves the run is over: it comes back empty.
    assert.equal(source.calls.length, 2);
  });

  it("withholds a half-read table from `data` but keeps it in `partial`", async () => {
    let call = 0;
    const { data, error, partial } = await fetchPaged<number>(() => {
      call += 1;
      return call === 1
        ? Promise.resolve({ data: Array.from({ length: FETCH_STEP }, () => 1), error: null })
        : Promise.resolve({ data: null, error: { message: "boom" } });
    });

    // A count from half a table is a wrong number, not a smaller one, so a
    // caller has to reach for `partial` deliberately.
    assert.equal(data, null);
    assert.deepEqual(error, { message: "boom" });
    assert.equal(partial.length, FETCH_STEP);
  });

  it("has `partial` equal to `data` on a clean read", async () => {
    const source = pageSource(10);
    const { data, partial } = await fetchPaged<number>(source.build);

    assert.deepEqual(partial, data);
  });
});

describe("chunk", () => {
  it("splits an oversized id list into URL-sized batches", () => {
    const ids = Array.from({ length: ID_CHUNK * 2 + 1 }, (_, i) => `id-${i}`);
    const chunks = chunk(ids);

    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, ID_CHUNK);
    assert.equal(chunks[2].length, 1);
    assert.deepEqual(chunks.flat(), ids);
  });

  it("returns nothing for an empty list rather than one empty chunk", () => {
    assert.deepEqual(chunk([]), []);
  });

  it("rejects a size that would never terminate", () => {
    assert.throws(() => chunk([1, 2, 3], 0), RangeError);
  });
});

describe("fetchPagedForOrgs", () => {
  it("makes no request at all when the CAM owns nothing", async () => {
    let called = false;
    const { data, error } = await fetchPagedForOrgs<number>([], () => {
      called = true;
      return Promise.resolve({ data: [], error: null });
    });

    assert.equal(called, false);
    assert.deepEqual(data, []);
    assert.equal(error, null);
  });

  it("pages each id chunk and concatenates the results in order", async () => {
    const ids = Array.from({ length: ID_CHUNK + 3 }, (_, i) => `id-${i}`);
    const seen: number[] = [];

    const { data } = await fetchPagedForOrgs<string>(ids, (batch) => {
      seen.push(batch.length);
      return Promise.resolve({ data: [...batch], error: null });
    });

    assert.deepEqual(seen, [ID_CHUNK, 3]);
    assert.deepEqual(data, ids);
  });

  it("abandons the whole read when one chunk fails", async () => {
    const ids = Array.from({ length: ID_CHUNK + 1 }, (_, i) => `id-${i}`);
    let batch = 0;

    const { data, error } = await fetchPagedForOrgs<string>(ids, () => {
      batch += 1;
      return batch === 1
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: null, error: { message: "boom" } });
    });

    assert.equal(data, null);
    assert.deepEqual(error, { message: "boom" });
  });
});
