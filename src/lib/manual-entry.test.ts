import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManualOrganisation,
  canApproveManualEntry,
  checkManualEntryCriteria,
  manualEntrySchema,
  reviewManualEntryFields,
  type ManualEntryApprovalChecks,
} from "./manual-entry.ts";

const input = { legalName: "Useful Charity", countryCode: "GB", website: "", contactEmail: "", registryName: "", registryNumber: "", reason: "Not present in available API sources." };

describe("manualEntrySchema", () => {
  it("accepts the approved Data Model fields", () => assert.equal(manualEntrySchema.safeParse(input).success, true));
  it("rejects missing name and an unexplained submission", () => assert.equal(manualEntrySchema.safeParse({ ...input, legalName: "", reason: "why" }).success, false));
});

describe("canApproveManualEntry", () => {
  it("fails closed while the duplicate decision is unresolved", async () => {
    const checks: ManualEntryApprovalChecks = {
      checkDuplicate: async () => ({ status: "blocked", message: "F042 needs a human duplicate decision." }),
    };
    const result = await canApproveManualEntry(input, checks, { organisationType: "charity" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.messages[0], /F042/);
  });
  it("allows approval only after F042 and the real F047 check pass", async () => {
    const pass = async () => ({ status: "passed" as const });
    assert.deepEqual(
      await canApproveManualEntry(
        input,
        { checkDuplicate: pass },
        { organisationType: "charity", countryCode: "GB" },
      ),
      { ok: true },
    );
  });
});

describe("reviewManualEntryFields", () => {
  it("flags invalid email and website fields without rejecting the record", () => {
    const review = reviewManualEntryFields(
      { ...input, contactEmail: "not-an-email", website: "broken website" },
    );
    assert.equal(review.email.status, "invalid");
    assert.equal(review.website.status, "invalid");
    assert.equal(review.warnings.length, 2);
  });

  it("does not turn missing optional fields into invalid-field warnings", () => {
    const review = reviewManualEntryFields(input);
    assert.equal(review.email.status, "missing");
    assert.equal(review.website.status, "missing");
    assert.deepEqual(review.warnings, []);
  });
});

describe("buildManualOrganisation", () => {
  it("builds the standard F041 shape with F043 manual provenance", () => {
    const organisation = buildManualOrganisation(
      {
        ...input,
        countryCode: "fr",
        website: "https://example.org",
        contactEmail: " HELLO@EXAMPLE.ORG ",
      },
      "charity",
    );
    assert.equal(organisation.entry_method, "manual");
    assert.equal(organisation.organisation_type, "charity");
    assert.equal(organisation.country_code, "FR");
    assert.equal(organisation.is_international, true);
    assert.equal(organisation.contact_email, "hello@example.org");
    assert.equal(organisation.website, "https://example.org/");
    assert.equal(organisation.outreach_status, "not_contacted");
    assert.equal(organisation.owner_id, null);
  });

  it("preserves invalid field values so warnings do not discard useful data", () => {
    const organisation = buildManualOrganisation(
      { ...input, website: "broken website", contactEmail: "bad email" },
      "other",
    );
    assert.equal(organisation.website, "broken website");
    assert.equal(organisation.contact_email, "bad email");
  });
});

describe("checkManualEntryCriteria", () => {
  it("fails closed when organisation type evidence is missing", () => {
    assert.deepEqual(checkManualEntryCriteria(), {
      status: "blocked",
      message: "Select or derive an organisation type before approving this manual entry.",
    });
  });

  it("passes an eligible charity through the shared F047 checker", () => {
    assert.deepEqual(checkManualEntryCriteria({ organisationType: "charity" }), { status: "passed" });
  });

  it("requires an explicit admin decision for an ambiguous company", () => {
    const result = checkManualEntryCriteria({ organisationType: "company" });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") assert.match(result.message, /admin eligibility decision/i);
    assert.deepEqual(
      checkManualEntryCriteria({ organisationType: "company", adminConfirmedEligible: true }),
      { status: "passed" },
    );
  });

  it("does not allow an organisation type outside F047 policy", () => {
    const result = checkManualEntryCriteria({ organisationType: "government" });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") assert.match(result.message, /does not meet/i);
  });
});
