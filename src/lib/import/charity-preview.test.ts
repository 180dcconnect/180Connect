import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { previewCharity, type CharityPreviewDependencies } from "./charity-preview.ts";
import type { RawCharityCommissionRecord } from "../standardize/charity-commission.ts";

function record(overrides: Partial<RawCharityCommissionRecord> = {}): RawCharityCommissionRecord {
  return {
    organisation_number: 500123,
    reg_charity_number: 1218781,
    charity_name: "Sheffield Example Trust",
    reg_status: "R",
    date_of_registration: "1998-04-01T00:00:00",
    date_of_removal: null,
    address_line_one: "12 High Street",
    address_line_five: "SHEFFIELD",
    address_post_code: "S1 2HE",
    web: "example.org",
    email: "info@example.org",
    latest_income: 250_000,
    latest_expenditure: 240_000,
    latest_acc_fin_year_start_date: "2024-04-01T00:00:00",
    latest_acc_fin_year_end_date: "2025-03-31T00:00:00",
    ...overrides,
  } as RawCharityCommissionRecord;
}

function deps(
  fetchRecord: CharityPreviewDependencies["fetchRecord"],
): CharityPreviewDependencies {
  return { fetchRecord };
}

describe("previewCharity", () => {
  it("returns what the importer would write, without writing it", async () => {
    const result = await previewCharity("1218781", deps(async () => record()));

    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.preview.organisation.legal_name, "Sheffield Example Trust");
    assert.equal(result.preview.organisation.organisation_type, "charity");
    assert.equal(result.preview.organisation.city, "Sheffield");
    assert.equal(result.preview.organisation.postcode, "S1 2HE");
    assert.equal(result.preview.identifier?.identifierValue, "1218781");
  });

  it("carries the latest filed year when the response has one", async () => {
    const result = await previewCharity("1218781", deps(async () => record()));
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.deepEqual(result.preview.financialPeriod, {
      periodStart: "2024-04-01",
      periodEnd: "2025-03-31",
      totalIncome: 250_000,
      totalExpenditure: 240_000,
      incomeBand: "100k_1m",
    });
  });

  it("reports no filed year rather than inventing one", async () => {
    const result = await previewCharity(
      "1218781",
      deps(async () => record({ latest_income: undefined, latest_expenditure: undefined })),
    );
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.preview.financialPeriod, null);
  });

  // The point of showing a verdict before saving: the reader learns what the
  // import would decide, from the same check the import runs.
  it("runs the client criteria check the promote loop would run", async () => {
    const result = await previewCharity("1218781", deps(async () => record()));
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.preview.criteria.outcome, "meets");
    assert.equal(result.preview.criteria.priority, "south_yorkshire");
  });

  it("flags a charity removed from the register", async () => {
    const result = await previewCharity(
      "1218781",
      deps(async () => record({ reg_status: "RM", date_of_removal: "2021-06-30T00:00:00" })),
    );
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.preview.registration.status, "removed");
    assert.equal(result.preview.registration.removedOn, "2021-06-30");
    assert.equal(result.preview.registration.registeredOn, "1998-04-01");
  });

  it("treats a removal date without the removed status as removed too", async () => {
    const result = await previewCharity(
      "1218781",
      deps(async () => record({ date_of_removal: "2021-06-30T00:00:00" })),
    );
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.preview.registration.status, "removed");
  });

  it("reports an unknown number as not found, not as a failure", async () => {
    const result = await previewCharity(
      "9999999",
      deps(async () => {
        throw new Error("Charity Commission could not find a charity with that registration number.");
      }),
    );
    assert.deepEqual(result, { status: "not_found" });
  });

  it("treats an empty response as not found", async () => {
    const result = await previewCharity("9999999", deps(async () => null));
    assert.deepEqual(result, { status: "not_found" });
  });

  it("passes through the adapter's own readable message for a malformed number", async () => {
    const result = await previewCharity(
      "abc",
      deps(async () => {
        throw new Error("Enter a valid Charity Commission registration number.");
      }),
    );
    assert.equal(result.status, "unavailable");
    if (result.status !== "unavailable") return;
    assert.equal(result.message, "Enter a valid Charity Commission registration number.");
  });

  // Upstream internals must not reach an admin's screen.
  it("hides an unexpected upstream error behind a generic message", async () => {
    const result = await previewCharity(
      "1218781",
      deps(async () => {
        throw new Error("Charity Commission details API returned 500");
      }),
    );
    assert.equal(result.status, "unavailable");
    if (result.status !== "unavailable") return;
    assert.match(result.message, /could not be reached/);
    assert.doesNotMatch(result.message, /500/);
  });

  it("prefers the identifier the importer derived over the string that was typed", async () => {
    const result = await previewCharity("  1218781  ", deps(async () => record()));
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.preview.registeredNumber, "1218781");
  });
});
