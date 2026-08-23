import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_FILTER_VALUE_LENGTH,
  MAX_VIEW_NAME_LENGTH,
  captureFilters,
  describeFilters,
  filterCount,
  filtersMatch,
  isCurrentView,
  normalizeViewName,
  parseFilters,
  savedViewHref,
} from "./saved-view-filters.ts";

describe("captureFilters", () => {
  it("keeps every filter the list actually has", () => {
    assert.deepEqual(
      captureFilters({
        q: "oxfam",
        city: ["Sheffield", "Leeds"],
        country: "GB",
        status: ["Meeting set"],
        type: ["charity", "cic"],
        owner: "user-1",
      }),
      {
        q: "oxfam",
        city: ["Sheffield", "Leeds"],
        country: ["GB"],
        status: ["Meeting set"],
        type: ["charity", "cic"],
        owner: "user-1",
      },
    );
  });

  it("drops params that are not filters", () => {
    // page, the list's sort and the insight band's controls are not part of a view
    // — see the module comment. A stray param a hostile client invents is dropped
    // by the same rule.
    assert.deepEqual(
      captureFilters({
        q: "oxfam",
        page: "4",
        stage: "converted",
        sort: "city",
        dir: "asc",
        listSort: "name",
        listDir: "desc",
        anything: "at all",
      }),
      { q: "oxfam" },
    );
  });

  it("treats blank and whitespace-only values as no filter", () => {
    assert.deepEqual(captureFilters({ q: "", city: ["   "], status: undefined }), {});
  });

  it("drops a multi-select that arrives all-blank rather than storing an empty array", () => {
    assert.deepEqual(captureFilters({ city: ["", "  "] }), {});
  });

  it("trims values so a saved view matches the one the CAM was looking at", () => {
    assert.deepEqual(captureFilters({ city: ["  Leeds  "] }), { city: ["Leeds"] });
  });

  it("dedupes repeated values", () => {
    assert.deepEqual(
      captureFilters({ city: ["Leeds", "Leeds", "Sheffield"] }),
      { city: ["Leeds", "Sheffield"] },
    );
  });

  it("drops a value longer than the cap rather than storing it", () => {
    const tooLong = "x".repeat(MAX_FILTER_VALUE_LENGTH + 1);
    assert.deepEqual(captureFilters({ q: tooLong }), {});
    assert.deepEqual(captureFilters({ city: ["Leeds", tooLong] }), { city: ["Leeds"] });
  });

  it("captures the empty combination for an unfiltered list", () => {
    assert.deepEqual(captureFilters({}), {});
  });
});

describe("parseFilters", () => {
  it("reads a stored filter set back", () => {
    assert.deepEqual(parseFilters({ q: "oxfam", city: ["Leeds"], type: "charity" }), {
      q: "oxfam",
      city: ["Leeds"],
      type: ["charity"],
    });
  });

  it("reads a pre-multi-select row whose multi keys hold single strings", () => {
    assert.deepEqual(parseFilters({ city: "Leeds" }), { city: ["Leeds"] });
  });

  it("ignores keys that are not filters, whatever is in the row", () => {
    assert.deepEqual(parseFilters({ city: ["Leeds"], evil: "1", page: "9" }), {
      city: ["Leeds"],
    });
  });

  it("ignores non-string values", () => {
    assert.deepEqual(parseFilters({ city: 42, status: null, q: ["a"] }), {});
  });

  it("returns nothing for a row whose filters are not an object", () => {
    assert.deepEqual(parseFilters(null), {});
    assert.deepEqual(parseFilters("q=oxfam"), {});
    assert.deepEqual(parseFilters(["oxfam"]), {});
    assert.deepEqual(parseFilters(undefined), {});
  });

  it("round-trips what captureFilters wrote", () => {
    const captured = captureFilters({
      q: "oxfam",
      owner: "unassigned",
      city: ["Leeds", "Sheffield"],
    });
    assert.deepEqual(parseFilters(captured), captured);
  });
});

describe("savedViewHref", () => {
  it("re-applies exactly the filters the view stored", () => {
    assert.equal(
      savedViewHref({ q: "oxfam", city: ["Leeds"], owner: "user-1" }),
      "/clients?q=oxfam&city=Leeds&owner=user-1",
    );
  });

  it("writes a multi-select as repeated params, how the page's own links do", () => {
    assert.equal(
      savedViewHref({ status: ["Contacted", "Meeting set"], country: ["GB", "KE"] }),
      "/clients?country=GB&country=KE&status=Contacted&status=Meeting+set",
    );
  });

  it("orders params the same way every time, whatever order they were written in", () => {
    assert.equal(
      savedViewHref({ owner: "user-1", city: ["Leeds"], q: "oxfam" }),
      savedViewHref({ q: "oxfam", city: ["Leeds"], owner: "user-1" }),
    );
  });

  it("is the plain list when the view has no filters", () => {
    assert.equal(savedViewHref({}), "/clients");
  });

  it("escapes values rather than breaking the query string", () => {
    assert.equal(
      savedViewHref({ status: ["Meeting set"], q: "a&b=c" }),
      "/clients?q=a%26b%3Dc&status=Meeting+set",
    );
  });

  it("carries no page number, so a re-applied view starts at page one", () => {
    // captureFilters already refuses `page`; this pins the other half of that rule.
    assert.equal(savedViewHref(captureFilters({ q: "oxfam", page: "4" })), "/clients?q=oxfam");
  });
});

describe("filtersMatch / isCurrentView", () => {
  it("matches the same combination", () => {
    assert.equal(filtersMatch({ q: "oxfam", city: ["Leeds"] }, { city: ["Leeds"], q: "oxfam" }), true);
  });

  it("matches a multi-select in the same order", () => {
    assert.equal(filtersMatch({ city: ["Leeds", "Leeds"] }, { city: ["Leeds", "Leeds"] }), true);
  });

  it("does not match when a filter differs", () => {
    assert.equal(filtersMatch({ city: ["Leeds"] }, { city: ["Sheffield"] }), false);
  });

  it("does not match when one side carries an extra filter", () => {
    assert.equal(filtersMatch({ city: ["Leeds"] }, { city: ["Leeds"], q: "oxfam" }), false);
  });

  it("does not match when only the selection order differs", () => {
    // The URL differs, so the list can differ; better to under-mark than lie.
    assert.equal(filtersMatch({ city: ["Leeds", "Sheffield"] }, { city: ["Sheffield", "Leeds"] }), false);
  });

  it("treats a missing filter and an empty one as the same", () => {
    assert.equal(filtersMatch({ city: ["Leeds"], q: "" }, { city: ["Leeds"] }), true);
  });

  it("marks the view whose filters are on screen as the current one", () => {
    const view = { city: ["Leeds"], status: ["Meeting set"] };
    assert.equal(isCurrentView(view, captureFilters({ ...view, page: "2" })), true);
  });
});

describe("filterCount", () => {
  it("counts only the filters that are set", () => {
    assert.equal(filterCount({}), 0);
    assert.equal(filterCount({ q: "oxfam" }), 1);
    assert.equal(filterCount({ q: "oxfam", city: ["Leeds"], owner: "unassigned" }), 3);
  });
});

describe("describeFilters", () => {
  it("reads out the filters in a fixed order", () => {
    assert.equal(
      describeFilters({
        q: "oxfam",
        type: ["Charity Commission"],
        city: ["Leeds"],
        status: ["Meeting set"],
      }),
      "“oxfam” · Charity Commission · Leeds · Meeting set",
    );
  });

  it("joins a multi-select with commas", () => {
    assert.equal(describeFilters({ city: ["Leeds", "Sheffield"] }), "Leeds, Sheffield");
  });

  it("names the owner when one is known", () => {
    assert.equal(describeFilters({ owner: "user-1" }, "Amara Okafor"), "Amara Okafor");
  });

  it("says unassigned without needing a name", () => {
    assert.equal(describeFilters({ owner: "unassigned" }), "Unassigned");
  });

  it("never shows a raw id for an owner it cannot name", () => {
    const described = describeFilters({ owner: "8f14e45f-ea27-4b9b-a1d2-000000000000" });
    assert.equal(described, "A former team member");
    assert.ok(!described.includes("8f14e45f"));
  });

  it("says so when the view has no filters", () => {
    assert.equal(describeFilters({}), "No filters — the whole list");
  });
});

describe("normalizeViewName", () => {
  it("trims a usable name", () => {
    assert.equal(normalizeViewName("  Leeds prospects  "), "Leeds prospects");
  });

  it("rejects a blank or whitespace-only name", () => {
    assert.equal(normalizeViewName(""), null);
    assert.equal(normalizeViewName("   "), null);
  });

  it("rejects a name past the column's cap", () => {
    assert.equal(normalizeViewName("x".repeat(MAX_VIEW_NAME_LENGTH)), "x".repeat(MAX_VIEW_NAME_LENGTH));
    assert.equal(normalizeViewName("x".repeat(MAX_VIEW_NAME_LENGTH + 1)), null);
  });

  it("rejects anything that is not a string", () => {
    assert.equal(normalizeViewName(undefined), null);
    assert.equal(normalizeViewName(42), null);
    assert.equal(normalizeViewName(null), null);
  });
});
