import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DUTY_QUEUE_SIZE, topDutyQueues, type DutyQueueEntry } from "./admin-queue-order.ts";

function entry(title: string, count: number): DutyQueueEntry {
  return { title, count, href: `/${title}`, description: title };
}

describe("topDutyQueues", () => {
  it("ranks the biggest backlog first", () => {
    const result = topDutyQueues([
      entry("Pending Suppressions", 200),
      entry("Incomplete Records", 1000),
      entry("Suggested Edits", 5),
    ]);
    assert.equal(result[0].title, "Incomplete Records");
    assert.equal(result[1].title, "Pending Suppressions");
  });

  it("always returns six, with zeros filling the rest", () => {
    const result = topDutyQueues([
      entry("Incomplete Records", 1000),
      entry("Pending Suppressions", 200),
      entry("Suggested Edits", 0),
      entry("Data Discrepancies", 0),
      entry("Register Status Changes", 0),
      entry("Ownership Requests", 0),
      entry("Possible Duplicates", 0),
      entry("High-Priority Unassigned Clients", 0),
    ]);
    assert.equal(result.length, DUTY_QUEUE_SIZE);
    assert.equal(DUTY_QUEUE_SIZE, 6);
    assert.deepEqual(
      result.map((q) => q.title),
      [
        "Incomplete Records",
        "Pending Suppressions",
        "Data Discrepancies",
        "High-Priority Unassigned Clients",
        "Ownership Requests",
        "Possible Duplicates",
      ],
    );
  });

  it("drops the two smallest queues when everything has work", () => {
    const result = topDutyQueues([
      entry("A", 8),
      entry("B", 7),
      entry("C", 6),
      entry("D", 5),
      entry("E", 4),
      entry("F", 3),
      entry("G", 2),
      entry("H", 1),
    ]);
    assert.deepEqual(
      result.map((q) => q.title),
      ["A", "B", "C", "D", "E", "F"],
    );
  });

  it("breaks ties alphabetically so the order is stable", () => {
    const result = topDutyQueues([entry("Bravo", 10), entry("Alpha", 10), entry("Charlie", 0)]);
    assert.deepEqual(
      result.map((q) => q.title),
      ["Alpha", "Bravo", "Charlie"],
    );
  });
});
