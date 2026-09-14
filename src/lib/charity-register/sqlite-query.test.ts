import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWhere,
  charitySearchQuery,
  countQuery,
  escapeLike,
  previewQuery,
  selectionQuery,
} from "./sqlite-query.ts";
import { normalisedNameSql } from "../register-search-term.ts";

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

  it("combines multiple names with OR", () => {
    const { clauses, params } = where({ names: ["hospice", "cancer"] });
    assert.match(clauses[0], /c\.charity_name like \? escape '\\' or c\.charity_name like \? escape '\\'/);
    assert.deepEqual(params, ["%hospice%", "%cancer%"]);
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

// The add-a-client lookup. The one thing it must never do is throw: it is
// driven directly by whatever somebody types into a search box.
describe("charitySearchQuery — matching", () => {
  it("matches a name anywhere in the registered name", () => {
    const { sql, params } = charitySearchQuery({ name: "Sheffield" }, 5);
    assert.ok(sql.includes(`${normalisedNameSql("charity_name")} like ? escape`));
    assert.deepEqual(params.slice(0, 2), ["%s%h%e%f%f%i%e%l%d%", "%sheffield%"]);
  });

  it("ranks an exact name first, then a prefix, then a contains", () => {
    const { sql, params } = charitySearchQuery({ name: "artregen" });
    assert.match(sql, /when lower\(charity_name\) = \? then 0/);
    assert.match(sql, /when lower\(charity_name\) like \? escape '[^']*' then 1/);
    // Relevance bindings come after the where clauses, before the limit.
    assert.deepEqual(params.slice(2, 4), ["artregen", "artregen%"]);
  });

  it("requires every typed word, in any order, and ignores stopwords", () => {
    const { params } = charitySearchQuery({ name: "The Trust Sheffield" });
    // Each word is a letters-in-order prefilter, then the normalised match.
    assert.deepEqual(params.slice(0, 4), ["%t%r%u%s%t%", "%trust%", "%s%h%e%f%f%i%e%l%d%", "%sheffield%"]);
  });

  it("looks a registered number up exactly, ignoring everything else", () => {
    const { sql, params } = charitySearchQuery({ registeredNumber: 1012345, name: "ignored", postcode: "S1" });
    assert.match(sql, /where registered_charity_number = \? order by/);
    assert.equal(params[0], 1012345);
  });

  it("narrows by town through the address lines", () => {
    const { sql, params } = charitySearchQuery({ name: "community", town: "Sheffield" });
    assert.match(sql, /lower\(coalesce\(address_lines, ''\)\) like \?/);
    assert.deepEqual(params.slice(1, 3), ["%community%", "%sheffield%"]);
  });

  it("combines a name and a postcode with AND", () => {
    const { sql, params } = charitySearchQuery({ name: "community", postcode: "S1 4FW" });
    assert.ok(sql.includes(`${normalisedNameSql("charity_name")} like ? escape '\\' and `));
    assert.deepEqual(params.slice(1, 3), ["%community%", "s1 4fw%"]);
  });

  it("reads a bare postcode as an outward code, not a prefix", () => {
    // "S1" must not match S10, S11 or S12 — three different districts.
    const { sql, params } = charitySearchQuery({ postcode: "S1" });
    assert.match(sql, /or lower\(coalesce\(postcode, ''\)\) = \?\)/);
    assert.deepEqual(params.slice(0, 2), ["s1 %", "s1"]);
  });

  it("treats a spaced postcode as the start of a full one", () => {
    const { sql, params } = charitySearchQuery({ postcode: "S1 4" });
    assert.doesNotMatch(sql, /or lower\(coalesce\(postcode, ''\)\) = \?/);
    assert.deepEqual(params.slice(0, 1), ["s1 4%"]);
  });

  it("collapses repeated whitespace so one spelling reaches one query", () => {
    const { params } = charitySearchQuery({ postcode: "S1   4FW" });
    assert.deepEqual(params.slice(0, 1), ["s1 4fw%"]);
  });

  it("matches nothing at all when both terms are too short", () => {
    const { sql } = charitySearchQuery({ name: "s" });
    // Not an empty clause list, which would emit `where order by` and throw.
    assert.match(sql, /from charity where 0 order by/);
  });

  it("ignores a term of only whitespace", () => {
    assert.match(charitySearchQuery({ name: "   " }).sql, /where 0/);
  });

  it("caps the page and refuses a caller asking for the whole register", () => {
    assert.equal(charitySearchQuery({ name: "ab" }, 500).params.at(-1), 25);
    assert.equal(charitySearchQuery({ name: "ab" }, 0).params.at(-1), 1);
  });
});

describe("escapeLike", () => {
  it("escapes the wildcards so a typed % cannot match everything", () => {
    assert.equal(escapeLike("50%"), "50\\%");
    assert.equal(escapeLike("a_b"), "a\\_b");
  });

  it("escapes the escape character itself", () => {
    assert.equal(escapeLike("a\\b"), "a\\\\b");
  });

  it("leaves ordinary text alone", () => {
    assert.equal(escapeLike("sheffield community centre"), "sheffield community centre");
  });
});
