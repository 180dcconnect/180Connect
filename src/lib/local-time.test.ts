import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OFFICE_CLOCKS, officeTimeIn } from "./local-time.ts";

describe("office clocks", () => {
  // A plain afternoon in September: BST and AEST are both in force, WAT never
  // changes, so the three offices read 1pm, 1pm and 10pm.
  const septemberNoonUtc = new Date("2026-09-16T12:00:00Z");

  it("shows each office the time it is actually there, with its marker", () => {
    assert.deepEqual(officeTimeIn(septemberNoonUtc, "Europe/London"), {
      time: "1:00",
      period: "pm",
    });
    assert.deepEqual(officeTimeIn(septemberNoonUtc, "Africa/Lagos"), {
      time: "1:00",
      period: "pm",
    });
    assert.deepEqual(officeTimeIn(septemberNoonUtc, "Australia/Sydney"), {
      time: "10:00",
      period: "pm",
    });
  });

  it("moves with a zone's own summer time instead of a fixed offset", () => {
    // Same reading on the clock, different half of the year: Sheffield drops to
    // GMT, so the office that is +1 in September is +0 in January and would be
    // an hour wrong all winter if the offset were hard-coded.
    assert.deepEqual(officeTimeIn(new Date("2026-01-16T12:00:00Z"), "Europe/London"), {
      time: "12:00",
      period: "pm",
    });
    // And Sydney goes the other way — +11 in January, +10 in September.
    assert.deepEqual(officeTimeIn(new Date("2026-01-16T12:00:00Z"), "Australia/Sydney"), {
      time: "11:00",
      period: "pm",
    });
  });

  it("reads midnight as 12 am and midday as 12 pm, never as 0", () => {
    // The two the marker makes easy to get wrong. 23:30 UTC is half past
    // midnight in London (BST), and 11:00 UTC in September is its lunchtime.
    assert.deepEqual(officeTimeIn(new Date("2026-09-16T23:30:00Z"), "Europe/London"), {
      time: "12:30",
      period: "am",
    });
    assert.deepEqual(officeTimeIn(new Date("2026-09-16T11:00:00Z"), "Europe/London"), {
      time: "12:00",
      period: "pm",
    });
    // And the far end of the same instant: 23:59 UTC in Lagos is 12:59 am —
    // the hour is still 12 and the day has already turned over.
    assert.deepEqual(officeTimeIn(new Date("2026-12-31T23:59:00Z"), "Africa/Lagos"), {
      time: "12:59",
      period: "am",
    });
  });

  it("gives every office a reading and a marker, whatever the hour", () => {
    for (const office of OFFICE_CLOCKS) {
      // Every hour of a day, so the one that happens to be 12 is covered
      // wherever in the world the office is.
      for (let hour = 0; hour < 24; hour += 1) {
        const { time, period } = officeTimeIn(
          new Date(Date.UTC(2026, 8, 16, hour, 5)),
          office.timeZone,
        );
        assert.match(time, /^\d{1,2}:\d{2}$/, `${office.city} at ${hour}:05 UTC`);
        assert.ok(
          period === "am" || period === "pm",
          `${office.city} at ${hour}:05 UTC has no marker: "${period}"`,
        );
      }
    }
  });

  it("zero-pads the minutes so the strip holds its column", () => {
    for (const office of OFFICE_CLOCKS) {
      const { time } = officeTimeIn(new Date("2026-09-16T01:05:00Z"), office.timeZone);
      assert.ok(time.endsWith(":05") || time.endsWith(":00"), time);
    }
  });

  it("names every office with a zone the runtime can resolve", () => {
    // Catches the trap this module exists to document: `Africa/Abuja` looks
    // plausible and is not a zone, and an invalid id only fails when the
    // formatter is used — in the browser, as a blank clock.
    for (const office of OFFICE_CLOCKS) {
      assert.doesNotThrow(
        () => new Intl.DateTimeFormat("en-GB", { timeZone: office.timeZone }),
        `${office.city} is not on a real time zone`,
      );
    }
  });
});
