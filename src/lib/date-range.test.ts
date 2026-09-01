import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GRID_CELLS,
  addMonths,
  buildMonthGrid,
  calendarPresets,
  clampPreset,
  dayFlags,
  isCompleteRange,
  monthKeyOf,
  monthLabel,
  nextSelection,
  orderPair,
  parseIsoDay,
  rangeLengthDays,
  todayIso,
  toIsoDay,
} from "./date-range.ts";

describe("parseIsoDay", () => {
  it("parses an ISO day to midnight UTC", () => {
    assert.equal(parseIsoDay("2026-09-01"), Date.UTC(2026, 8, 1));
  });

  it("rejects anything that is not a bare ISO day", () => {
    for (const bad of [null, undefined, "", "2026-9-1", "2026-09-01T00:00:00Z", "nonsense"]) {
      assert.equal(parseIsoDay(bad), null);
    }
  });
});

describe("todayIso", () => {
  it("takes the UTC day, not the local one", () => {
    // 23:30 UTC on 1 Sept is still 1 Sept, even where local time has rolled over.
    assert.equal(todayIso(new Date("2026-09-01T23:30:00Z")), "2026-09-01");
  });
});

describe("addMonths", () => {
  it("steps forward and back within a year", () => {
    assert.equal(addMonths("2026-06", 1), "2026-07");
    assert.equal(addMonths("2026-06", -1), "2026-05");
  });

  it("rolls over the year boundary in both directions", () => {
    assert.equal(addMonths("2026-12", 1), "2027-01");
    assert.equal(addMonths("2026-01", -1), "2025-12");
    assert.equal(addMonths("2026-01", -13), "2024-12");
  });
});

describe("monthLabel", () => {
  it("names the month and year", () => {
    assert.equal(monthLabel("2026-08"), "August 2026");
  });
});

describe("buildMonthGrid", () => {
  it("always returns six weeks, so the calendar never changes height", () => {
    for (const month of ["2026-02", "2026-08", "2027-01", "2024-02"]) {
      assert.equal(buildMonthGrid(month).length, GRID_CELLS);
    }
  });

  it("starts on the Monday of the week containing the 1st", () => {
    // 1 Sept 2026 is a Tuesday, so the grid opens on Monday 31 Aug.
    assert.equal(buildMonthGrid("2026-09")[0].iso, "2026-08-31");
  });

  it("does not borrow days when the 1st is itself a Monday", () => {
    // 1 June 2026 is a Monday.
    const grid = buildMonthGrid("2026-06");
    assert.equal(grid[0].iso, "2026-06-01");
    assert.equal(grid[0].inMonth, true);
  });

  it("marks borrowed days as out of month", () => {
    const grid = buildMonthGrid("2026-09");
    assert.equal(grid[0].inMonth, false);
    assert.equal(grid[1].iso, "2026-09-01");
    assert.equal(grid[1].inMonth, true);
  });

  it("counts the right number of in-month days", () => {
    const count = (month: string) => buildMonthGrid(month).filter((cell) => cell.inMonth).length;
    assert.equal(count("2026-09"), 30);
    assert.equal(count("2026-02"), 28);
    // 2028 is a leap year.
    assert.equal(count("2028-02"), 29);
  });

  it("runs consecutive days with no gaps or repeats", () => {
    const grid = buildMonthGrid("2026-09");
    for (let i = 1; i < grid.length; i += 1) {
      const previous = parseIsoDay(grid[i - 1].iso)!;
      const current = parseIsoDay(grid[i].iso)!;
      assert.equal(current - previous, 24 * 60 * 60 * 1000);
    }
  });

  it("reports the day of the month, not the grid index", () => {
    const grid = buildMonthGrid("2026-09");
    assert.equal(grid[0].dayOfMonth, 31);
    assert.equal(grid[1].dayOfMonth, 1);
  });
});

describe("orderPair", () => {
  it("returns the pair low-first whichever way it arrives", () => {
    assert.deepEqual(orderPair("2026-09-10", "2026-09-01"), { lo: "2026-09-01", hi: "2026-09-10" });
    assert.deepEqual(orderPair("2026-09-01", "2026-09-10"), { lo: "2026-09-01", hi: "2026-09-10" });
  });
});

describe("dayFlags", () => {
  const today = "2026-09-10";

  it("marks nothing when there is no selection", () => {
    const flags = dayFlags("2026-09-05", { selection: { from: null, to: null }, today });
    assert.equal(flags.isStart, false);
    assert.equal(flags.isInRange, false);
    assert.equal(flags.isPreview, false);
  });

  it("draws a lone start so the first click lands visibly", () => {
    const selection = { from: "2026-09-05", to: null };
    assert.equal(dayFlags("2026-09-05", { selection, today }).isStart, true);
    assert.equal(dayFlags("2026-09-06", { selection, today }).isInRange, false);
  });

  it("marks the ends and the inside of a committed range", () => {
    const selection = { from: "2026-09-05", to: "2026-09-08" };
    const start = dayFlags("2026-09-05", { selection, today });
    const middle = dayFlags("2026-09-06", { selection, today });
    const end = dayFlags("2026-09-08", { selection, today });
    const outside = dayFlags("2026-09-09", { selection, today });

    assert.deepEqual([start.isStart, start.isEnd, start.isInside], [true, false, false]);
    assert.deepEqual([middle.isStart, middle.isEnd, middle.isInside], [false, false, true]);
    assert.deepEqual([end.isStart, end.isEnd, end.isInside], [false, true, false]);
    assert.equal(outside.isInRange, false);
    assert.equal(start.isPreview, false);
  });

  it("treats a single-day range as both ends and never inside", () => {
    const selection = { from: "2026-09-05", to: "2026-09-05" };
    const flags = dayFlags("2026-09-05", { selection, today });
    assert.deepEqual([flags.isStart, flags.isEnd, flags.isInside], [true, true, false]);
  });

  it("previews the range under the cursor before the second click", () => {
    const context = { selection: { from: "2026-09-05", to: null }, hover: "2026-09-08", today };
    assert.equal(dayFlags("2026-09-06", context).isInside, true);
    assert.equal(dayFlags("2026-09-06", context).isPreview, true);
    assert.equal(dayFlags("2026-09-08", context).isEnd, true);
    assert.equal(dayFlags("2026-09-09", context).isInRange, false);
  });

  it("previews backwards when hovering before the start", () => {
    const context = { selection: { from: "2026-09-08", to: null }, hover: "2026-09-05", today };
    assert.equal(dayFlags("2026-09-05", context).isStart, true);
    assert.equal(dayFlags("2026-09-08", context).isEnd, true);
    assert.equal(dayFlags("2026-09-06", context).isInside, true);
  });

  it("ignores hover once the range is committed", () => {
    const context = {
      selection: { from: "2026-09-05", to: "2026-09-06" },
      hover: "2026-09-20",
      today,
    };
    assert.equal(dayFlags("2026-09-10", context).isInRange, false);
    assert.equal(dayFlags("2026-09-06", context).isPreview, false);
  });

  it("does not preview into a day that is out of bounds", () => {
    const context = {
      selection: { from: "2026-09-05", to: null },
      hover: "2026-09-30",
      max: "2026-09-10",
      today,
    };
    assert.equal(dayFlags("2026-09-08", context).isInRange, false);
  });

  it("disables days outside min and max", () => {
    const context = {
      selection: { from: null, to: null },
      min: "2026-09-05",
      max: "2026-09-10",
      today,
    };
    assert.equal(dayFlags("2026-09-04", context).isDisabled, true);
    assert.equal(dayFlags("2026-09-05", context).isDisabled, false);
    assert.equal(dayFlags("2026-09-10", context).isDisabled, false);
    assert.equal(dayFlags("2026-09-11", context).isDisabled, true);
  });

  it("marks today", () => {
    const context = { selection: { from: null, to: null }, today };
    assert.equal(dayFlags(today, context).isToday, true);
    assert.equal(dayFlags("2026-09-11", context).isToday, false);
  });
});

describe("nextSelection", () => {
  it("starts a range on the first click", () => {
    assert.deepEqual(nextSelection({ from: null, to: null }, "2026-09-05"), {
      from: "2026-09-05",
      to: null,
    });
  });

  it("closes the range on a later second click", () => {
    assert.deepEqual(nextSelection({ from: "2026-09-05", to: null }, "2026-09-08"), {
      from: "2026-09-05",
      to: "2026-09-08",
    });
  });

  it("allows a single-day range", () => {
    assert.deepEqual(nextSelection({ from: "2026-09-05", to: null }, "2026-09-05"), {
      from: "2026-09-05",
      to: "2026-09-05",
    });
  });

  it("restarts rather than swapping when the second click is earlier", () => {
    assert.deepEqual(nextSelection({ from: "2026-09-08", to: null }, "2026-09-05"), {
      from: "2026-09-05",
      to: null,
    });
  });

  it("starts over once a range is complete", () => {
    assert.deepEqual(nextSelection({ from: "2026-09-05", to: "2026-09-08" }, "2026-09-20"), {
      from: "2026-09-20",
      to: null,
    });
  });
});

describe("isCompleteRange", () => {
  it("requires both ends, in order", () => {
    assert.equal(isCompleteRange({ from: "2026-09-05", to: "2026-09-08" }), true);
    assert.equal(isCompleteRange({ from: "2026-09-05", to: "2026-09-05" }), true);
    assert.equal(isCompleteRange({ from: "2026-09-05", to: null }), false);
    assert.equal(isCompleteRange({ from: null, to: "2026-09-05" }), false);
    assert.equal(isCompleteRange({ from: "2026-09-08", to: "2026-09-05" }), false);
  });
});

describe("rangeLengthDays", () => {
  it("counts inclusively", () => {
    assert.equal(rangeLengthDays("2026-09-01", "2026-09-01"), 1);
    assert.equal(rangeLengthDays("2026-09-01", "2026-09-07"), 7);
  });

  it("counts across a month boundary", () => {
    assert.equal(rangeLengthDays("2026-08-31", "2026-09-01"), 2);
  });

  it("returns zero for an unparseable end", () => {
    assert.equal(rangeLengthDays("2026-09-01", "nope"), 0);
  });
});

describe("calendarPresets", () => {
  const NOW = new Date("2026-09-10T12:00:00Z");

  it("offers this month, last month and this quarter", () => {
    assert.deepEqual(
      calendarPresets(NOW).map((preset) => [preset.label, preset.from, preset.to]),
      [
        ["This month", "2026-09-01", "2026-09-10"],
        ["Last month", "2026-08-01", "2026-08-31"],
        ["This quarter", "2026-07-01", "2026-09-10"],
      ],
    );
  });

  it("rolls last month back over a year boundary", () => {
    const presets = calendarPresets(new Date("2026-01-15T00:00:00Z"));
    const last = presets.find((preset) => preset.label === "Last month")!;
    assert.deepEqual([last.from, last.to], ["2025-12-01", "2025-12-31"]);
  });

  it("ends last month on the correct day for February in a leap year", () => {
    const presets = calendarPresets(new Date("2028-03-05T00:00:00Z"));
    const last = presets.find((preset) => preset.label === "Last month")!;
    assert.equal(last.to, "2028-02-29");
  });
});

describe("clampPreset", () => {
  const preset = { label: "Last month", from: "2026-08-01", to: "2026-08-31" };

  it("passes a preset through when it fits inside the bounds", () => {
    assert.deepEqual(clampPreset(preset, "2026-01-01", "2026-12-31"), preset);
  });

  it("pulls the start up to min", () => {
    assert.deepEqual(clampPreset(preset, "2026-08-15", null), {
      ...preset,
      from: "2026-08-15",
    });
  });

  it("pulls the end down to max", () => {
    assert.deepEqual(clampPreset(preset, null, "2026-08-20"), { ...preset, to: "2026-08-20" });
  });

  it("drops a preset that falls entirely before the window", () => {
    assert.equal(clampPreset(preset, "2026-09-01", "2026-09-30"), null);
  });

  it("drops a preset that falls entirely after the window", () => {
    assert.equal(clampPreset(preset, "2026-01-01", "2026-07-31"), null);
  });

  it("is unbounded when neither bound is given", () => {
    assert.deepEqual(clampPreset(preset), preset);
  });
});

describe("monthKeyOf / toIsoDay", () => {
  it("takes the month from an ISO day", () => {
    assert.equal(monthKeyOf("2026-09-10"), "2026-09");
  });

  it("round-trips through ms", () => {
    assert.equal(toIsoDay(parseIsoDay("2026-09-10")!), "2026-09-10");
  });
});
