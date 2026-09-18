import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  acceptCharity,
  createCharityCommissionBulkAdapter,
  type BulkCharityPayload,
  type BulkCharityRow,
} from "./charity-commission-bulk.ts";

/** A register row with the shape the real extract publishes. */
function charity(overrides: Partial<BulkCharityRow> = {}): BulkCharityRow {
  return {
    organisation_number: 1,
    registered_charity_number: 1000001,
    linked_charity_number: 0,
    charity_name: "SHEFFIELD EXAMPLE TRUST",
    charity_type: "Trust",
    charity_registration_status: "Registered",
    charity_reporting_status: "Submission Received",
    date_of_registration: "1990-01-01T00:00:00",
    latest_income: 250_000,
    latest_expenditure: 240_000,
    latest_acc_fin_period_start_date: "2024-04-01T00:00:00",
    latest_acc_fin_period_end_date: "2025-03-31T00:00:00",
    charity_contact_address1: "1 High Street",
    charity_contact_address2: null,
    charity_contact_address3: null,
    charity_contact_address4: null,
    charity_contact_address5: "Sheffield",
    charity_contact_postcode: "S1 2HE",
    charity_contact_phone: "0114 000 0000",
    charity_contact_email: "info@example.org",
    charity_contact_web: "example.org",
    charity_company_registration_number: null,
    charity_is_cio: false,
    charity_activities: "Runs a community centre.",
    ...overrides,
  };
}

const IN_SECTOR = new Map([[1, ["Education/training"]]]);
const IN_AREA = new Map([[1, ["Sheffield"]]]);
const NO_SECTOR = new Map<number, string[]>();
const NO_AREA = new Map<number, string[]>();

describe("acceptCharity", () => {
  it("accepts a registered, funded, in-sector, local charity", () => {
    assert.deepEqual(acceptCharity(charity(), IN_SECTOR, IN_AREA), { accepted: true });
  });

  it("rejects a removed charity", () => {
    const result = acceptCharity(
      charity({ charity_registration_status: "Removed" }),
      IN_SECTOR,
      IN_AREA,
    );
    assert.deepEqual(result, { accepted: false, reason: "not_registered" });
  });

  it("rejects a linked subsidiary row so its parent is imported once", () => {
    const result = acceptCharity(charity({ linked_charity_number: 2 }), IN_SECTOR, IN_AREA);
    assert.equal(result.reason, "linked");
  });

  it("rejects a charity below the income floor, and one with no income filed", () => {
    assert.equal(acceptCharity(charity({ latest_income: 40_000 }), IN_SECTOR, IN_AREA).reason, "income");
    assert.equal(acceptCharity(charity({ latest_income: null }), IN_SECTOR, IN_AREA).reason, "income");
  });

  it("rejects a charity whose classification is not one we approach", () => {
    assert.equal(acceptCharity(charity(), NO_SECTOR, IN_AREA).reason, "sector");
  });

  it("accepts on postcode alone when the register lists no area of operation", () => {
    assert.equal(acceptCharity(charity(), IN_SECTOR, NO_AREA).accepted, true);
  });

  it("accepts on area of operation alone when the address is elsewhere", () => {
    const result = acceptCharity(
      charity({ charity_contact_postcode: "EC1A 1BB" }),
      IN_SECTOR,
      IN_AREA,
    );
    assert.equal(result.accepted, true);
  });

  it("does not mistake a Swansea postcode for a Sheffield one", () => {
    // The bug this guards: startsWith("S") matches SA, SE, SK, SL, SW… about a
    // tenth of the register.
    const result = acceptCharity(
      charity({ charity_contact_postcode: "SA1 1AA" }),
      IN_SECTOR,
      NO_AREA,
    );
    assert.equal(result.reason, "area");
  });
});

/** Writes the extracts the adapter reads, in the register's own line format. */
function writeExtracts(dir: string, files: Record<string, unknown[]>) {
  for (const [name, rows] of Object.entries(files)) {
    const body = rows.length === 0
      ? "[]"
      : `[${rows.map((row) => JSON.stringify(row)).join("\n,")}\n]`;
    writeFileSync(join(dir, `${name}.json`), `﻿${body}`, "utf8");
  }
}

function fixtureDir(files: Record<string, unknown[]>): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-bulk-"));
  writeExtracts(dir, files);
  return dir;
}

describe("createCharityCommissionBulkAdapter", () => {
  const baseFiles = () => ({
    "publicextract.charity": [
      charity(),
      charity({ organisation_number: 2, charity_name: "ARTS ELSEWHERE", latest_income: 900_000 }),
    ],
    "publicextract.charity_classification": [
      { organisation_number: 1, classification_type: "What", classification_description: "Education/training" },
      { organisation_number: 1, classification_type: "Who", classification_description: "Children/young People" },
      { organisation_number: 2, classification_type: "What", classification_description: "Arts/culture/heritage/science" },
    ],
    "publicextract.charity_area_of_operation": [
      { organisation_number: 1, geographic_area_type: "Local Authority", geographic_area_description: "Sheffield" },
      { organisation_number: 2, geographic_area_type: "Local Authority", geographic_area_description: "Kent" },
    ],
    "publicextract.charity_annual_return_parta": [
      {
        organisation_number: 1,
        fin_period_start_date: "2024-04-01T00:00:00",
        fin_period_end_date: "2025-03-31T00:00:00",
        ar_received_date: "2025-11-30T00:00:00",
        count_volunteers: 40,
        total_gross_income: 250_000,
      },
      { organisation_number: 2, fin_period_end_date: "2025-03-31T00:00:00", count_volunteers: 5 },
    ],
    "publicextract.charity_annual_return_partb": [
      {
        organisation_number: 1,
        fin_period_start_date: "2024-04-01T00:00:00",
        fin_period_end_date: "2025-03-31T00:00:00",
        count_employees: 6,
        income_donations_and_legacies: 100_000,
      },
    ],
  });

  it("returns one record per accepted charity, with its returns joined", async () => {
    const adapter = createCharityCommissionBulkAdapter({ localDir: fixtureDir(baseFiles()) });
    const result = await adapter.fetch();

    assert.equal(result.records.length, 1, "the arts charity in Kent is not ours");
    assert.equal(result.records[0].source_record_id, "1");
    assert.equal(result.truncated, false);

    const payload = result.records[0].raw_payload as BulkCharityPayload;
    assert.equal(payload.charity.charity_name, "SHEFFIELD EXAMPLE TRUST");
    assert.deepEqual(payload.matched_classifications, ["Education/training"]);
    assert.deepEqual(payload.matched_areas, ["Sheffield"]);
    assert.equal(payload.annual_returns.length, 1, "Part A and B merge into one period");
    assert.equal(payload.annual_returns[0].count_volunteers, 40, "Part A survives");
    assert.equal(payload.annual_returns[0].count_employees, 6, "Part B joins it");
  });

  it("keeps the contact email in the payload for the data-handling rules to judge", async () => {
    // The adapter must not pre-emptively strip contact details: applyDataHandling
    // is the single place that decides, and a role address like info@ is one the
    // policy deliberately keeps.
    const adapter = createCharityCommissionBulkAdapter({ localDir: fixtureDir(baseFiles()) });
    const result = await adapter.fetch();
    const payload = result.records[0].raw_payload as BulkCharityPayload;
    assert.equal(payload.charity.charity_contact_email, "info@example.org");
  });

  it("reports the run as truncated when a limit stops it early", async () => {
    const files = baseFiles();
    files["publicextract.charity"] = [
      charity(),
      charity({ organisation_number: 3, registered_charity_number: 1000003 }),
    ];
    files["publicextract.charity_classification"].push({
      organisation_number: 3,
      classification_type: "What",
      classification_description: "Education/training",
    });

    const adapter = createCharityCommissionBulkAdapter({
      localDir: fixtureDir(files),
      limit: 1,
    });
    const result = await adapter.fetch();

    assert.equal(result.records.length, 1);
    assert.equal(result.truncated, true, "a capped run is a partial run");
  });

  it("survives a malformed line instead of losing the pass", async () => {
    const dir = fixtureDir(baseFiles());
    writeFileSync(
      join(dir, "publicextract.charity.json"),
      `﻿[${JSON.stringify(charity())}\n,{"organisation_number": broken}\n]`,
      "utf8",
    );

    const adapter = createCharityCommissionBulkAdapter({ localDir: dir });
    const result = await adapter.fetch();
    assert.equal(result.records.length, 1);
  });

  it("reports what it scanned, so a filter change is visible before it is written", async () => {
    let stats: { charitiesScanned: number; accepted: number } | null = null;
    const adapter = createCharityCommissionBulkAdapter({
      localDir: fixtureDir(baseFiles()),
      onStats: (next) => {
        stats = next;
      },
    });
    await adapter.fetch();

    assert.equal(stats!.charitiesScanned, 2);
    assert.equal(stats!.accepted, 1);
  });
});
