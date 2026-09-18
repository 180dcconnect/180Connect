import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  comparisonRows,
  toPendingReview,
  toQueueRecord,
  UNNAMED_RECORD,
  type CandidateOrganisationSummary,
  type ComparisonRow,
  type EntityMatchCandidateRow,
} from "./duplicates.ts";
import { INCOME_BAND_LABELS } from "./income-band.ts";

/**
 * The two records an admin is asked to compare. Every test below is about the
 * question the screen exists to answer — same charity, or two? — and about the
 * rows that no longer get to answer it by accident: a bulk register record read
 * only at the top level, and a comparison that marked punctuation as a
 * disagreement.
 */
function bulkCandidate(
  overrides: {
    charity?: Record<string, unknown>;
    organisation?: Partial<CandidateOrganisationSummary> | null;
  } = {},
): EntityMatchCandidateRow {
  const { charity = {}, organisation = {} } = overrides;

  return {
    id: "flag-1",
    raw_source_record_id: "raw-1",
    candidate_organisation_id: "org-1",
    match_score: 0.92,
    match_method: "fuzzy_name",
    match_status: "pending",
    reviewed_by_user_id: null,
    reviewed_at: null,
    notes: null,
    created_at: "2026-08-12T09:00:00Z",
    candidate_organisation:
      organisation === null
        ? null
        : {
            legal_name: "Sheffield Example Trust",
            postcode: "S1 2HE",
            address_line_1: "12 High Street",
            website: "example.org",
            organisation_identifiers: [
              { identifier_type: "uk_charity", identifier_value: "1000001" },
            ],
            financial_periods: [
              {
                period_end: "2025-03-31",
                total_income: 880_000,
                income_band: "100k_1m",
                financial_source: "charity_commission",
              },
            ],
            ...organisation,
          },
    raw_source_record: {
      record_source: "charity_commission_bulk",
      source_record_id: "500001",
      raw_payload: {
        charity: {
          charity_name: "SHEFFIELD EXAMPLE TRUST",
          registered_charity_number: 1000001,
          charity_contact_address1: "12 High Street",
          charity_contact_postcode: "S1 2HE",
          charity_contact_web: "example.org",
          latest_income: 900_000,
          ...charity,
        },
      },
    },
    reviewed_by_user: null,
  };
}

function rowFor(rows: ComparisonRow[], key: ComparisonRow["key"]): ComparisonRow {
  const found = rows.find((row) => row.key === key);
  assert.ok(found, `expected a ${key} row`);
  return found;
}

describe("toQueueRecord — what an incoming record is called", () => {
  it("reads the name a bulk register record keeps inside its charity object", () => {
    assert.equal(toQueueRecord(bulkCandidate()).name, "SHEFFIELD EXAMPLE TRUST");
  });

  it("says so plainly when a source published no name at all", () => {
    assert.equal(toQueueRecord(bulkCandidate({ charity: { charity_name: null } })).name, UNNAMED_RECORD);
  });
});

describe("comparisonRows — the two records side by side", () => {
  it("lists the fields in the order a person reads two records in", () => {
    const rows = comparisonRows(bulkCandidate());
    assert.deepEqual(
      rows.map((row) => row.key),
      ["name", "charity_number", "postcode", "address", "website", "income"],
    );
    assert.deepEqual(
      rows.map((row) => row.label),
      ["Name", "Charity number", "Postcode", "Address", "Website", "Latest income"],
    );
  });

  it("sets the register's copy of each field beside the client's", () => {
    const rows = comparisonRows(bulkCandidate());

    const name = rowFor(rows, "name");
    assert.equal(name.register, "SHEFFIELD EXAMPLE TRUST");
    assert.equal(name.client, "Sheffield Example Trust");

    const income = rowFor(rows, "income");
    assert.equal(income.register, "£900k");
    assert.equal(income.client, "£880k");
    assert.equal(income.clientNote, "year ending 31 Mar 2025");
  });

  it("marks no difference on records that agree", () => {
    const rows = comparisonRows(bulkCandidate());
    assert.deepEqual(
      rows.filter((row) => row.differs),
      [],
    );
  });

  it("marks a name that the importer itself would not call the same", () => {
    const rows = comparisonRows(
      bulkCandidate({ organisation: { legal_name: "1-1 Coco Trust" } }),
    );
    assert.equal(rowFor(rows, "name").differs, true);
  });

  it("does not call Ltd/Limited or punctuation a difference", () => {
    const rows = comparisonRows(
      bulkCandidate({ organisation: { legal_name: "Sheffield Example Trust LTD." } }),
    );
    assert.equal(rowFor(rows, "name").differs, false);
  });

  it("marks a postcode and a registration number that disagree", () => {
    const rows = comparisonRows(
      bulkCandidate({
        organisation: {
          postcode: "LS1 1AA",
          organisation_identifiers: [{ identifier_type: "uk_charity", identifier_value: "9999999" }],
        },
      }),
    );

    assert.equal(rowFor(rows, "postcode").differs, true);
    assert.equal(rowFor(rows, "charity_number").differs, true);
  });

  it("does not call a zero-padded company number a difference", () => {
    const rows = comparisonRows(
      bulkCandidate({
        charity: { charity_company_registration_number: "01336352" },
        organisation: {
          organisation_identifiers: [
            { identifier_type: "uk_charity", identifier_value: "1000001" },
            { identifier_type: "uk_company", identifier_value: "1336352" },
          ],
        },
      }),
    );

    assert.equal(rowFor(rows, "company_number").register, "01336352");
    assert.equal(rowFor(rows, "company_number").differs, false);
  });

  it("compares a postal address without punishing formatting", () => {
    const rows = comparisonRows(
      bulkCandidate({ organisation: { address_line_1: "12, high street" } }),
    );
    assert.equal(rowFor(rows, "address").differs, false);
  });

  it("compares a website without punishing the scheme or a trailing slash", () => {
    const rows = comparisonRows(
      bulkCandidate({ organisation: { website: "https://www.example.org/" } }),
    );
    assert.equal(rowFor(rows, "website").differs, false);
  });

  it("compares income by band, not by figure", () => {
    const sameBand = comparisonRows(
      bulkCandidate({ charity: { latest_income: 950_000 } }),
    );
    assert.equal(rowFor(sameBand, "income").differs, false);

    const otherBand = comparisonRows(
      bulkCandidate({
        charity: { latest_income: 2_400_000 },
      }),
    );
    assert.equal(rowFor(otherBand, "income").differs, true);
  });

  it("reads the client's latest year end, not the row written last", () => {
    const rows = comparisonRows(
      bulkCandidate({
        organisation: {
          financial_periods: [
            { period_end: "2023-03-31", total_income: 1_000_000, income_band: "100k_1m", financial_source: "charity_commission" },
            { period_end: "2025-03-31", total_income: 880_000, income_band: "100k_1m", financial_source: "charity_commission" },
            { period_end: "2024-03-31", total_income: 700_000, income_band: "100k_1m", financial_source: "charity_commission" },
          ],
        },
      }),
    );

    const income = rowFor(rows, "income");
    assert.equal(income.client, "£880k");
    assert.equal(income.clientNote, "year ending 31 Mar 2025");
  });

  it("says when the client's figure was entered by hand rather than filed", () => {
    const rows = comparisonRows(
      bulkCandidate({
        organisation: {
          financial_periods: [
            { period_end: "2025-03-31", total_income: 880_000, income_band: "100k_1m", financial_source: "manual" },
          ],
        },
      }),
    );

    assert.equal(rowFor(rows, "income").clientNote, "entered by hand · year ending 31 Mar 2025");
  });

  it("falls back to the client's income band when no figure was ever published", () => {
    const rows = comparisonRows(
      bulkCandidate({
        organisation: {
          financial_periods: [
            { period_end: "2025-03-31", total_income: null, income_band: "100k_500k", financial_source: "charity_commission" },
          ],
        },
      }),
    );

    assert.equal(rowFor(rows, "income").client, INCOME_BAND_LABELS["100k_500k"]);
  });

  it("drops a field neither record has anything for", () => {
    const rows = comparisonRows(
      bulkCandidate({
        charity: {
          charity_contact_address1: null,
          charity_contact_postcode: null,
          charity_contact_web: null,
          latest_income: null,
        },
        organisation: {
          postcode: null,
          address_line_1: null,
          website: null,
          financial_periods: [],
        },
      }),
    );

    assert.deepEqual(
      rows.map((row) => row.key),
      ["name", "charity_number"],
    );
  });

  it("keeps a field the register has and the client has not, without calling it a difference", () => {
    const rows = comparisonRows(
      bulkCandidate({
        charity: { charity_company_registration_number: "01336352" },
      }),
    );

    const company = rowFor(rows, "company_number");
    assert.equal(company.register, "01336352");
    assert.equal(company.client, null);
    assert.equal(company.differs, false);
  });

  it("shows the register's side alone when no client is linked to the flag", () => {
    const rows = comparisonRows(bulkCandidate({ organisation: null }));

    assert.equal(rowFor(rows, "name").register, "SHEFFIELD EXAMPLE TRUST");
    assert.equal(rowFor(rows, "name").client, null);
    assert.deepEqual(
      rows.filter((row) => row.differs),
      [],
    );
  });
});

describe("toPendingReview", () => {
  it("carries the name and the comparison together, so the card needs both", () => {
    const review = toPendingReview(bulkCandidate());
    assert.equal(review.name, "SHEFFIELD EXAMPLE TRUST");
    assert.equal(review.row.match_status, "pending");
    assert.equal(rowFor(review.comparison, "postcode").client, "S1 2HE");
  });
});
