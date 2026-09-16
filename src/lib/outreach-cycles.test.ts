import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cycleContaining,
  cyclePhase,
  cycleWindow,
  cyclesOverlap,
  describeCycleWindow,
  filterByWindow,
  findCycleByName,
  findCycleOverlap,
  orderCyclesByStart,
  parseCycleDate,
  parseCycleInput,
  previousCycle,
  type OutreachCycle,
} from "./outreach-cycles.ts";

function cycle(overrides: Partial<OutreachCycle> = {}): OutreachCycle {
  return {
    id: "cycle-1",
    name: "Spring 26",
    starts_on: "2026-01-12",
    ends_on: "2026-04-03",
    ...overrides,
  };
}

describe("parseCycleDate", () => {
  it("accepts a real calendar day", () => {
    assert.equal(parseCycleDate("2026-01-12"), "2026-01-12");
    assert.equal(parseCycleDate("2026-02-28"), "2026-02-28");
  });

  it("rejects impossible days rather than normalising them", () => {
    assert.equal(parseCycleDate("2026-02-30"), null);
    assert.equal(parseCycleDate("2026-13-01"), null);
    assert.equal(parseCycleDate("12 Jan 2026"), null);
    assert.equal(parseCycleDate(null), null);
  });
});

describe("parseCycleInput", () => {
  it("trims the name and keeps valid dates", () => {
    const result = parseCycleInput({ name: "  Spring 26 ", startsOn: "2026-01-12", endsOn: "2026-04-03" });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.data, { name: "Spring 26", startsOn: "2026-01-12", endsOn: "2026-04-03" });
  });

  it("asks for a name in plain words", () => {
    const result = parseCycleInput({ name: "   ", startsOn: "2026-01-12", endsOn: "2026-04-03" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /name/);
  });

  it("refuses an end before the start in plain words", () => {
    const result = parseCycleInput({ name: "Spring 26", startsOn: "2026-04-03", endsOn: "2026-01-12" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /last day cannot be before the first/);
  });

  it("allows a single-day cycle", () => {
    const result = parseCycleInput({ name: "Launch day", startsOn: "2026-01-12", endsOn: "2026-01-12" });
    assert.equal(result.ok, true);
  });
});

describe("cyclesOverlap", () => {
  const spring = { starts_on: "2026-01-12", ends_on: "2026-04-03" };

  it("shares even a single day", () => {
    assert.equal(cyclesOverlap(spring, { starts_on: "2026-04-03", ends_on: "2026-06-01" }), true);
    assert.equal(cyclesOverlap(spring, { starts_on: "2026-02-01", ends_on: "2026-02-28" }), true);
  });

  it("passes adjacent ranges", () => {
    assert.equal(cyclesOverlap(spring, { starts_on: "2026-04-04", ends_on: "2026-06-01" }), false);
  });
});

describe("findCycleOverlap", () => {
  it("names the colliding cycle and skips the row being saved", () => {
    const cycles = [cycle(), cycle({ id: "cycle-2", name: "Autumn 25", starts_on: "2025-09-01", ends_on: "2025-12-15" })];
    const hit = findCycleOverlap(cycles, { starts_on: "2026-03-01", ends_on: "2026-05-01" });
    assert.equal(hit?.name, "Spring 26");
    assert.equal(findCycleOverlap(cycles, { starts_on: "2026-01-12", ends_on: "2026-04-03" }, "cycle-1"), null);
    assert.equal(findCycleOverlap(cycles, { starts_on: "2026-05-01", ends_on: "2026-06-01" }), null);
  });
});

describe("cyclePhase", () => {
  it("counts both the first and the last day as inside the cycle", () => {
    assert.equal(cyclePhase(cycle(), "2026-01-12"), "running");
    assert.equal(cyclePhase(cycle(), "2026-04-03"), "running");
  });

  it("puts a day before the start in the future", () => {
    assert.equal(cyclePhase(cycle(), "2026-01-11"), "upcoming");
  });

  it("puts a day after the end in the past", () => {
    assert.equal(cyclePhase(cycle(), "2026-04-04"), "finished");
  });

  it("handles a single-day cycle", () => {
    const launch = cycle({ starts_on: "2026-01-12", ends_on: "2026-01-12" });
    assert.equal(cyclePhase(launch, "2026-01-12"), "running");
    assert.equal(cyclePhase(launch, "2026-01-13"), "finished");
  });
});

describe("findCycleByName", () => {
  it("ignores case and surrounding spaces, as the table's name_key does", () => {
    const cycles = [cycle()];
    assert.equal(findCycleByName(cycles, "  spring 26 ")?.name, "Spring 26");
    assert.equal(findCycleByName(cycles, "SPRING 26")?.name, "Spring 26");
  });

  it("lets a cycle keep its own name", () => {
    const cycles = [cycle()];
    assert.equal(findCycleByName(cycles, "Spring 26", "cycle-1"), null);
  });

  it("passes a name nobody is using, and an empty one", () => {
    const cycles = [cycle()];
    assert.equal(findCycleByName(cycles, "Summer 26"), null);
    assert.equal(findCycleByName(cycles, "   "), null);
  });
});

describe("cycleWindow and filterByWindow", () => {
  it("covers the whole last day and nothing after it", () => {
    const window = cycleWindow(cycle());
    const rows = [
      { at: "2026-01-12T00:00:00Z" },
      { at: "2026-04-03T23:59:59Z" },
      { at: "2026-04-04T00:00:00Z" },
      { at: "2026-01-11T23:59:59Z" },
      { at: null },
    ];
    assert.deepEqual(
      filterByWindow(rows, (row) => row.at, window).map((row) => row.at),
      ["2026-01-12T00:00:00Z", "2026-04-03T23:59:59Z"],
    );
  });
});

describe("cycleContaining", () => {
  it("attributes an event to the cycle holding its date", () => {
    const cycles = [
      cycle(),
      cycle({ id: "cycle-2", name: "Autumn 25", starts_on: "2025-09-01", ends_on: "2025-12-15" }),
    ];
    assert.equal(cycleContaining(cycles, "2026-02-01T10:00:00Z")?.name, "Spring 26");
    assert.equal(cycleContaining(cycles, "2025-10-01T10:00:00Z")?.name, "Autumn 25");
    assert.equal(cycleContaining(cycles, "2025-01-01T10:00:00Z"), null);
    assert.equal(cycleContaining(cycles, null), null);
  });
});

describe("previousCycle", () => {
  it("picks the latest cycle ending before this one starts", () => {
    const cycles = [
      cycle(),
      cycle({ id: "cycle-2", name: "Autumn 25", starts_on: "2025-09-01", ends_on: "2025-12-15" }),
      cycle({ id: "cycle-3", name: "Summer 25", starts_on: "2025-05-01", ends_on: "2025-08-01" }),
    ];
    assert.equal(previousCycle(cycles, cycle())?.name, "Autumn 25");
    assert.equal(previousCycle(cycles, cycles[2]), null);
  });
});

describe("orderCyclesByStart and describeCycleWindow", () => {
  it("orders oldest first", () => {
    const ordered = orderCyclesByStart([
      cycle(),
      cycle({ id: "cycle-2", name: "Autumn 25", starts_on: "2025-09-01", ends_on: "2025-12-15" }),
    ]);
    assert.deepEqual(ordered.map((entry) => entry.name), ["Autumn 25", "Spring 26"]);
  });

  it("describes the window in words", () => {
    assert.equal(describeCycleWindow(cycle()), "12 Jan 2026 – 3 Apr 2026");
  });
});
