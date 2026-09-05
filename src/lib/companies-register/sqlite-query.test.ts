import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWhere,
  countQuery,
  previewQuery,
  selectionQuery,
  sicValuesQuery,
} from "./sqlite-query.ts";

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
    assert.match(clauses[0], /exists \(select 1 from company_sic/);
    assert.deepEqual(params, ["86101"]);
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
