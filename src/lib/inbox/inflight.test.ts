import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InflightRequests } from "./inflight.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("InflightRequests", () => {
  it("shares one starter across concurrent calls with the same key", async () => {
    const inflight = new InflightRequests();
    let starts = 0;
    const gate = deferred<string>();
    const first = inflight.run("thread-1", async () => {
      starts += 1;
      return gate.promise;
    });
    const second = inflight.run("thread-1", async () => {
      starts += 1;
      return "unreachable";
    });

    gate.resolve("hydrated");
    assert.deepEqual(await Promise.all([first, second]), ["hydrated", "hydrated"]);
    assert.equal(starts, 1);
  });

  it("starts separately per key", async () => {
    const inflight = new InflightRequests();
    const calls: string[] = [];
    await Promise.all([
      inflight.run("a", async () => {
        calls.push("a");
        return 1;
      }),
      inflight.run("b", async () => {
        calls.push("b");
        return 2;
      }),
    ]);
    assert.deepEqual(calls.sort(), ["a", "b"]);
  });

  it("releases the key once settled so later calls refetch", async () => {
    const inflight = new InflightRequests();
    let starts = 0;
    const gate = deferred<string>();
    const first = inflight.run("thread-1", async () => {
      starts += 1;
      return gate.promise;
    });
    gate.resolve("first");
    assert.equal(await first, "first");
    // Let the release microtask run before the next call.
    await Promise.resolve();
    await inflight.run("thread-1", async () => {
      starts += 1;
      return "second";
    });
    assert.equal(starts, 2);
  });

  it("propagates rejection to every waiter and still releases", async () => {
    const inflight = new InflightRequests();
    let starts = 0;
    const gate = deferred<string>();
    const first = inflight.run("thread-1", async () => {
      starts += 1;
      return gate.promise;
    });
    const second = inflight.run("thread-1", async () => {
      starts += 1;
      return gate.promise;
    });

    gate.reject(new Error("network down"));
    await assert.rejects(first, /network down/);
    await assert.rejects(second, /network down/);
    await Promise.resolve();
    await inflight.run("thread-1", async () => {
      starts += 1;
      return "recovered";
    });
    assert.equal(starts, 2);
  });
});
