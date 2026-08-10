import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkClientCriteria } from "./client-criteria.ts";

describe("checkClientCriteria", () => {
  it("accepts a Sheffield charity and gives it local priority", () => {
    const result = checkClientCriteria({
      organisationType: "charity",
      city: " Sheffield ",
      postcode: "S1 2AB",
    });
    assert.equal(result.outcome, "meets");
    assert.equal(result.priority, "south_yorkshire");
  });

  it("does not confuse other S postcode areas with Sheffield", () => {
    for (const postcode of ["ST1 1AA", "SO14 1AA", "SR1 1AA", "SW1A 1AA", "SE1 1AA", "SM1 1AA", "SL1 1AA", "SS1 1AA"]) {
      assert.equal(checkClientCriteria({ organisationType: "charity", postcode }).priority, "standard");
    }
    assert.equal(checkClientCriteria({ organisationType: "charity", postcode: "S10 2TN" }).priority, "south_yorkshire");
  });

  it("accepts national and international charities without requiring local status", () => {
    assert.equal(checkClientCriteria({ organisationType: "charity", countryCode: "GB", geographicReach: "national" }).outcome, "meets");
    assert.equal(checkClientCriteria({ organisationType: "both", countryCode: "KE", geographicReach: "international" }).outcome, "meets");
  });

  it("sends ambiguous companies and other organisations to human review", () => {
    assert.equal(checkClientCriteria({ organisationType: "company" }).outcome, "needs_review");
    assert.equal(checkClientCriteria({ organisationType: "other" }).outcome, "needs_review");
  });

  it("does not make healthcare a requirement", () => {
    const ordinary = checkClientCriteria({ organisationType: "charity", sector: "education" });
    const health = checkClientCriteria({ organisationType: "charity", mission: "Patient healthcare support" });
    assert.equal(ordinary.outcome, "meets");
    assert.equal(ordinary.healthcareAligned, false);
    assert.equal(health.outcome, "meets");
    assert.equal(health.healthcareAligned, true);
  });

  it("rejects an organisation type outside the configured policy", () => {
    assert.equal(checkClientCriteria({ organisationType: "commercial" }).outcome, "does_not_meet");
  });

  it("accepts an injected policy instead of hiding rules in import code", () => {
    const result = checkClientCriteria(
      { organisationType: "company" },
      {
        acceptedOrganisationTypes: ["company"],
        reviewOrganisationTypes: [],
        strongEvidenceTypes: [],
        priorityCities: [],
        priorityPostcodePrefixes: [],
        healthcareKeywords: [],
      },
    );
    assert.equal(result.outcome, "meets");
  });
});

describe("checkClientCriteria — sourceConfidence strong-evidence bypass", () => {
  it("meets when a review type carries strong source confidence", () => {
    const result = checkClientCriteria({ organisationType: "company", sourceConfidence: "strong" });
    assert.equal(result.outcome, "meets");
  });

  it("still needs review when source confidence is weak or absent", () => {
    assert.equal(
      checkClientCriteria({ organisationType: "company", sourceConfidence: "weak" }).outcome,
      "needs_review",
    );
    assert.equal(checkClientCriteria({ organisationType: "company" }).outcome, "needs_review");
  });

  it("does not extend strong confidence to a type outside strongEvidenceTypes", () => {
    const result = checkClientCriteria(
      { organisationType: "other", sourceConfidence: "strong" },
      {
        acceptedOrganisationTypes: ["charity", "both"],
        reviewOrganisationTypes: ["company", "other"],
        strongEvidenceTypes: ["company"],
        priorityCities: [],
        priorityPostcodePrefixes: [],
        healthcareKeywords: [],
      },
    );
    assert.equal(result.outcome, "needs_review");
  });

  it("an already-accepted type stays meets regardless of sourceConfidence", () => {
    const result = checkClientCriteria({ organisationType: "charity", sourceConfidence: "weak" });
    assert.equal(result.outcome, "meets");
  });
});
