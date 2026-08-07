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
        priorityCities: [],
        priorityPostcodePrefixes: [],
        healthcareKeywords: [],
      },
    );
    assert.equal(result.outcome, "meets");
  });
});
