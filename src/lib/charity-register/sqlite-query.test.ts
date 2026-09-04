import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildWhere, countQuery, previewQuery, selectionQuery } from "./sqlite-query.ts";

const where = (filters: Parameters<typeof buildWhere>[0]) => buildWhere(filters);

describe("buildWhere — nothing filtered", () => {
  it("produces no clauses at all for an empty filter set", () => {
    // The screen opens on the whole register. If this ever fails, a criterion
    // has crept back in where nobody can see it — the exact fault this rewrite
    // exists to remove.
    const { clauses, params } = where({});
    assert.deepEqual(clauses, []);
    assert.deepEqual(params, []);
  });

  it("emits a bare select when there is nothing to filter", () => {
    assert.equal(countQuery({}).sql.trim(), "select count(*) as total from charity c");
  });

  it("treats empty lists as 'any', not 'none'", () => {
    const { clauses } = where({
      classifications: { what: [], who: [], how: [] },
      areas: { localAuthority: [] },
      postcodeAreas: [],
    });
    assert.deepEqual(clauses, []);
  });
});

describe("buildWhere — income", () => {
  it("includes unpublished income by default", () => {
    const { clauses, params } = where({ incomeMin: 10_000 });
    assert.equal(clauses.length, 1);
    assert.match(clauses[0], /latest_income >= \?/);
    assert.match(clauses[0], /or c\.latest_income is null/);
    assert.deepEqual(params, [10_000]);
  });

  it("drops the null branch only when explicitly excluded", () => {
    const { clauses } = where({
      incomeMin: 10_000,
      incomeMax: 50_000,
      includeUnpublishedIncome: false,
    });
    assert.equal(clauses.length, 1);
    assert.doesNotMatch(clauses[0], /is null/);
    assert.match(clauses[0], /latest_income >= \? and c\.latest_income <= \?/);
  });

  it("applies nothing when no bound is set", () => {
    // Excluding unpublished income with no bounds would silently drop charities
    // for no stated reason.
    assert.deepEqual(where({ includeUnpublishedIncome: false }).clauses, []);
  });

  it("binds a zero floor rather than ignoring it", () => {
    assert.deepEqual(where({ incomeMin: 0 }).params, [0]);
  });
});

describe("buildWhere — location", () => {
  it("ORs postcode area with declared area by default", () => {
    const { clauses, params } = where({
      postcodeAreas: ["S", "DN"],
      areas: { localAuthority: ["Sheffield City"] },
    });
    assert.equal(clauses.length, 1);
    assert.match(clauses[0], / or /);
    assert.match(clauses[0], /postcode_area in \(\?, \?\)/);
    assert.deepEqual(params, ["S", "DN", "Local Authority", "Sheffield City"]);
  });

  it("ANDs them when locationMatch is all", () => {
    const { clauses } = where({
      postcodeAreas: ["S"],
      areas: { localAuthority: ["Sheffield City"] },
      locationMatch: "all",
    });
    assert.match(clauses[0], / and /);
    assert.doesNotMatch(clauses[0], / or /);
  });

  it("uses the register's own spelling", () => {
    // "Sheffield City" is how the register writes it. Matching "sheffield"
    // is what previously hid 127 charities working in Sheffield.
    const { params } = where({ areas: { localAuthority: ["Sheffield City"] } });
    assert.ok(params.includes("Sheffield City"));
  });

  it("normalises a full postcode down to its area", () => {
    assert.deepEqual(where({ postcodeAreas: ["s1 2he"] }).params, ["S"]);
  });
});

describe("buildWhere — classifications", () => {
  it("makes one clause per dimension, ORing values inside it", () => {
    const { clauses, params } = where({
      classifications: { what: ["Disability", "Amateur Sport"], who: ["Children/young People"] },
    });
    assert.equal(clauses.length, 2);
    assert.deepEqual(params, [
      "What", "Disability", "Amateur Sport",
      "Who", "Children/young People",
    ]);
  });

  it("uses exists so a charity with three matching causes appears once", () => {
    const { clauses } = where({ classifications: { what: ["Disability", "Recreation"] } });
    assert.match(clauses[0], /^exists \(select 1 from charity_label/);
    // Nested subquery, not a join: the join made a local-area count take 830ms.
    assert.match(clauses[0], /cl\.label_id in \(select id from label/);
  });
});

describe("buildWhere — other clauses", () => {
  it("escapes LIKE wildcards in a name search", () => {
    const { clauses, params } = where({ nameContains: "50_50%" });
    assert.match(clauses[0], /like \? escape/);
    assert.deepEqual(params, ["%50\\_50\\%%"]);
  });

  it("adds filed-accounts and solvency clauses only when asked", () => {
    assert.deepEqual(where({}).clauses, []);
    const { clauses } = where({ hasFiledAccounts: true, excludeInsolvent: true });
    assert.ok(clauses.some((c) => c.includes("latest_period_end is not null")));
    assert.ok(clauses.some((c) => c.includes("insolvent = 0")));
  });

  it("binds registration date bounds", () => {
    const { params } = where({ registeredFrom: "2026-01-01", registeredTo: "2026-06-30" });
    assert.deepEqual(params, ["2026-01-01", "2026-06-30"]);
  });
});

describe("query shapes", () => {
  it("orders the preview by income with nulls last", () => {
    const { sql, params } = previewQuery({}, 10);
    assert.match(sql, /order by c\.latest_income is null, c\.latest_income desc limit \?/);
    assert.deepEqual(params, [10]);
  });

  it("orders a selection by a unique column so a cap is stable", () => {
    // Income is not unique — thousands of nulls, many shared round figures — so
    // ordering by it would make a capped import non-deterministic.
    const { sql, params } = selectionQuery({ incomeMin: 5 }, 100);
    assert.match(sql, /order by c\.organisation_number limit \?$/);
    assert.deepEqual(params, [5, 100]);
  });

  it("omits the limit entirely when there is none", () => {
    assert.doesNotMatch(selectionQuery({}).sql, /limit/);
  });
});
