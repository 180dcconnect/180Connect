import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CATEGORY_TO_SLUG } from "./csv-row.ts";
import {
  companyTypeLabel,
  COMPANY_STATUS_OPTIONS,
  DEFAULT_STATUSES,
  sicSectionOf,
  SIC_SECTIONS,
} from "./vocabulary.ts";

describe("sicSectionOf", () => {
  it("maps mission codes to their sections", () => {
    assert.equal(sicSectionOf("86101"), "Q");
    assert.equal(sicSectionOf("85100"), "P");
    assert.equal(sicSectionOf("90010"), "R");
    assert.equal(sicSectionOf("94990"), "S");
  });

  it("returns null in the numbering gaps and for garbage", () => {
    assert.equal(sicSectionOf("04000"), null);
    assert.equal(sicSectionOf("44000"), null);
    assert.equal(sicSectionOf("8610"), null);
    assert.equal(sicSectionOf(""), null);
  });

  it("covers every section letter exactly once", () => {
    const letters = SIC_SECTIONS.map((section) => section.letter).sort();
    assert.deepEqual(letters, [..."ABCDEFGHIJKLMNOPQRSTU"]);
  });
});

describe("companyTypeLabel", () => {
  it("labels every slug the build stores", () => {
    const slugs = new Set(Object.values(CATEGORY_TO_SLUG));
    for (const slug of slugs) {
      const label = companyTypeLabel(slug);
      assert.ok(label.length > 0 && label !== slug, `no label for ${slug}`);
    }
  });

  it("title-cases an unknown slug instead of blanking it", () => {
    assert.equal(companyTypeLabel("brand-new-form"), "Brand New Form");
  });
});

describe("status vocabulary", () => {
  it("defaults to live companies only", () => {
    assert.deepEqual([...DEFAULT_STATUSES], ["active"]);
    assert.ok(COMPANY_STATUS_OPTIONS.some((option) => option.value === "active"));
  });
});
