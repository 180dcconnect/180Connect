import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWhere,
  companySearchQuery,
  countQuery,
  previewQuery,
  selectionQuery,
  sicTitlesQuery,
  sicValuesQuery,
} from "./sqlite-query.ts";
import { normalisedNameSql } from "../register-search-term.ts";

describe("buildWhere", () => {
  it("selects live companies when nothing is asked", () => {
    const { clauses, params } = buildWhere({});
    assert.deepEqual(clauses, ["c.status_norm in (?)"]);
    assert.deepEqual(params, ["active"]);
  });

  it("drops the status clause when every status is asked for", () => {
    const { clauses } = buildWhere({ statuses: [] });
    assert.deepEqual(clauses, []);
  });

  it("filters SIC through the normalised table, not a join", () => {
    const { clauses, params } = buildWhere({ sicCodes: ["86101"], statuses: [] });
    assert.equal(clauses.length, 1);
    assert.match(clauses[0], /c\.number in \(select s\.number from company_sic/);
    assert.deepEqual(params, ["86101"]);
  });

  // Pinned because the obvious rewrite is a correlated `exists`, which reads
  // naturally and is what the charity twin does, but plans the wrong way
  // round on a table this size: it drives from company's 716k live rows and
  // never uses company_sic_by_sic. Measured 909ms vs 88ms on the September
  // 2026 file. If this assertion fails, re-read the note in sqlite-query.ts
  // before "simplifying" it back.
  it("does not correlate the SIC subquery on the company row", () => {
    const { clauses } = buildWhere({ sicCodes: ["86101", "85310"], statuses: [] });
    assert.equal(clauses.length, 1);
    assert.doesNotMatch(clauses[0], /s\.number\s*=\s*c\.number/);
    assert.doesNotMatch(clauses[0], /exists/);
  });

  it("combines CIC, type, postcode and dates with AND", () => {
    const { clauses, params } = buildWhere({
      cicOnly: true,
      companyTypes: ["ltd"],
      postcodeAreas: ["S"],
      incorporatedFrom: "2020-01-01",
      statuses: ["active"],
    });
    assert.deepEqual(clauses, [
      "c.is_cic = 1",
      "c.cat_slug in (?)",
      "c.postcode_area in (?)",
      "c.incorp_date >= ?",
      "c.status_norm in (?)",
    ]);
    assert.deepEqual(params, ["ltd", "S", "2020-01-01", "active"]);
  });

  it("ORs multiple name tokens and escapes LIKE wildcards", () => {
    const { clauses, params } = buildWhere({ names: ["50_50", "100%"], statuses: [] });
    assert.equal(clauses.length, 1);
    assert.match(clauses[0], /^\(.* or .*\)$/);
    assert.deepEqual(params, ["%50\\_50%", "%100\\%%"]);
  });
});

describe("countQuery / previewQuery / selectionQuery", () => {
  it("counts the live register by default", () => {
    const query = countQuery({});
    assert.match(query.sql, /select count\(\*\) as total from company c where/);
    assert.deepEqual(query.params, ["active"]);
  });

  it("previews alphabetically with a bound limit", () => {
    const query = previewQuery({ statuses: [] }, 10);
    assert.match(query.sql, /order by c\.name limit \?/);
    assert.deepEqual(query.params, [10]);
  });

  it("selects in stable number order for capped imports", () => {
    const query = selectionQuery({ statuses: [] }, 100);
    assert.match(query.sql, /order by c\.number limit \?/);
    assert.deepEqual(query.params, [100]);
  });
});

describe("sicValuesQuery", () => {
  it("reads titles and per-code counts from the file", () => {
    const query = sicValuesQuery();
    assert.match(query.sql, /from company_sic s join sic_label l/);
    assert.match(query.sql, /group by l\.sic, l\.title/);
    assert.deepEqual(query.params, []);
  });
});

describe("sicTitlesQuery", () => {
  it("reads sic_label alone, never the 1.06M-row company_sic table", () => {
    const { sql } = sicTitlesQuery(["85590", "88990"]);
    assert.match(sql, /from sic_label/);
    assert.doesNotMatch(sql, /company_sic/);
  });

  it("binds one placeholder per code", () => {
    const { sql, params } = sicTitlesQuery(["85590", "88990", "86900"]);
    assert.match(sql, /where sic in \(\?, \?, \?\)/);
    assert.deepEqual(params, ["85590", "88990", "86900"]);
  });

  it("copies the codes rather than aliasing the caller's array", () => {
    const codes = ["85590"];
    const { params } = sicTitlesQuery(codes);
    codes.push("88990");
    assert.deepEqual(params, ["85590"]);
  });
});

// The Companies House half of the add-a-client lookup. It has to survive
// whatever is typed, and it has to read a bare postcode as an outward code —
// the same two rules its charity twin is held to.
describe("companySearchQuery", () => {
  it("matches a name anywhere and ranks exact, then prefix, then contains", () => {
    const { sql, params } = companySearchQuery({ name: "Sheffield" }, 5);
    assert.ok(sql.includes(`${normalisedNameSql("name")} like ? escape`));
    assert.match(sql, /when lower\(name\) = \? then 0/);
    assert.match(sql, /when lower\(name\) like \? escape '[^']*' then 1/);
    assert.deepEqual(params.slice(0, 2), ["%s%h%e%f%f%i%e%l%d%", "%sheffield%"]);
    assert.deepEqual(params.slice(2, 4), ["sheffield", "sheffield%"]);
  });

  it("reads a bare postcode as an outward code", () => {
    const { params } = companySearchQuery({ postcode: "S1" });
    assert.deepEqual(params.slice(0, 2), ["s1 %", "s1"]);
  });

  it("treats a spaced postcode as the start of a full one", () => {
    const { sql, params } = companySearchQuery({ postcode: "S1 2HE" });
    assert.doesNotMatch(sql, /or lower\(coalesce\(postcode, ''\)\) = \?/);
    assert.deepEqual(params.slice(0, 1), ["s1 2he%"]);
  });

  it("returns no rows rather than invalid SQL for a one-letter term", () => {
    const { sql } = companySearchQuery({ name: "s" });
    assert.match(sql, /from company where 0 order by/);
  });

  it("escapes wildcards in the typed term", () => {
    const { params } = companySearchQuery({ name: "a_b" });
    assert.equal(params[0], "%a\\_b%");
  });

  it("caps the page", () => {
    assert.equal(companySearchQuery({ name: "ab" }, 500).params.at(-1), 25);
  });

  it("looks a company number up exactly, ignoring everything else", () => {
    const { sql, params } = companySearchQuery({ number: "sc123456", name: "ignored" });
    assert.match(sql, /where number = \? order by/);
    assert.equal(params[0], "SC123456");
  });

  it("narrows by the register's town", () => {
    const { sql, params } = companySearchQuery({ name: "trust", town: "Leeds" });
    assert.match(sql, /lower\(coalesce\(town, ''\)\) like \?/);
    assert.deepEqual(params.slice(1, 3), ["%trust%", "%leeds%"]);
  });
});
