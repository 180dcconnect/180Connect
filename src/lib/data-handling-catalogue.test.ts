import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogueKey,
  excludedFieldLabel,
  findCatalogueEntry,
  humanizeFieldPath,
  RULE_CATALOGUE,
  ruleEffect,
  sourceLabel,
} from "./data-handling-catalogue.ts";

describe("RULE_CATALOGUE", () => {
  it("names all 25 rules the F246 and F247 migrations seed", () => {
    assert.equal(RULE_CATALOGUE.length, 25);
  });

  it("has no duplicate rules", () => {
    const keys = RULE_CATALOGUE.map(catalogueKey);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("never shows a path or code in a label", () => {
    for (const entry of RULE_CATALOGUE) {
      assert.doesNotMatch(entry.label, /[_[\]*.#]|\bdeny\b/i, entry.label);
      assert.ok(entry.description.trim(), `missing description for ${entry.label}`);
      assert.ok(entry.reason.trim(), `missing reason for ${entry.label}`);
    }
  });
});

describe("findCatalogueEntry", () => {
  it("finds a source-specific rule", () => {
    assert.equal(
      findCatalogueEntry("companies_house", "officers[*].date_of_birth")?.label,
      "Company officers' dates of birth",
    );
  });

  it("finds a global redaction rule", () => {
    assert.equal(
      findCatalogueEntry(null, "*", "redact_personal_email")?.label,
      "Personal email addresses",
    );
  });

  it("returns null for an unknown rule", () => {
    assert.equal(findCatalogueEntry("candid", "board[*].salary"), null);
  });
});

describe("excludedFieldLabel", () => {
  it("names a removed field", () => {
    assert.equal(excludedFieldLabel("trustees[*].home_address"), "Trustees' home addresses");
  });

  it("names a blanked field from its path#kind form", () => {
    assert.equal(excludedFieldLabel("html#redact_phone_number"), "Phone numbers on charity websites");
  });

  it("returns null for an unknown entry", () => {
    assert.equal(excludedFieldLabel("mystery.field"), null);
  });
});

describe("humanizeFieldPath", () => {
  it("reads snake_case paths with array wildcards", () => {
    assert.equal(
      humanizeFieldPath("officers[*].usual_residential_address"),
      "Officers › Usual residential address",
    );
  });

  it("splits camelCase keys", () => {
    assert.equal(
      humanizeFieldPath("recipientOrganization[*].addressLocality"),
      "Recipient organization › Address locality",
    );
  });

  it("handles a single top-level key", () => {
    assert.equal(humanizeFieldPath("address_post_code"), "Address post code");
  });
});

describe("sourceLabel and ruleEffect", () => {
  it("labels sources in plain English", () => {
    assert.equal(sourceLabel(null), "Every source");
    assert.equal(sourceLabel("charity_commission"), "Charity Commission");
  });

  it("tells removal from blanking", () => {
    assert.equal(ruleEffect("field_path"), "removed");
    assert.equal(ruleEffect("redact_personal_email"), "blanked");
  });
});
