import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeRawRecord,
  matchesRecordFilters,
  recordFilterOptions,
  recordStatusKey,
  sortRecords,
  type RawSourceRecordRow,
} from "./record-format.ts";

const NOW = new Date("2026-08-15T12:00:00.000Z");

function row(overrides: Partial<RawSourceRecordRow> = {}): RawSourceRecordRow {
  return {
    id: "raw-1",
    ingestion_run_id: "run-1",
    record_source: "charity_commission",
    source_record_id: "1122334",
    raw_payload: { charity_name: "Leeds Hospice", city: "Leeds", type: "cio" },
    received_at: "2026-08-15T11:00:00.000Z",
    processing_status: "validated",
    matched_organisation_id: null,
    checksum: "abc",
    ingestion_attempt: 1,
    source_country: "GB",
    source_registry_name: "Charity Commission",
    excluded_fields: null,
    rule_version_applied: null,
    ...overrides,
  };
}

const view = (
  overrides: Partial<RawSourceRecordRow> = {},
  options?: { heldForReview?: boolean },
) => describeRawRecord(row(overrides), null, NOW, options);

describe("recordStatusKey", () => {
  it("splits a record held for review off the rejected pile", () => {
    assert.equal(recordStatusKey("rejected", true), "rejected_review");
    assert.equal(recordStatusKey("rejected", false), "rejected");
  });

  it("only applies the split to rejected records", () => {
    assert.equal(recordStatusKey("validated", true), "validated");
  });
});

describe("matchesRecordFilters", () => {
  it("passes every record when nothing is chosen", () => {
    assert.equal(matchesRecordFilters(view(), {}), true);
    assert.equal(matchesRecordFilters(view(), { status: [], place: [] }), true);
  });

  it("filters on what became of the record", () => {
    const added = view({ processing_status: "validated" });
    assert.equal(matchesRecordFilters(added, { status: ["validated"] }), true);
    assert.equal(matchesRecordFilters(added, { status: ["pending"] }), false);
  });

  it("does not return a record waiting for an admin under 'did not meet the criteria'", () => {
    const held = view({ processing_status: "rejected" }, { heldForReview: true });
    const settled = view({ processing_status: "rejected" });

    assert.equal(matchesRecordFilters(held, { status: ["rejected"] }), false);
    assert.equal(matchesRecordFilters(held, { status: ["rejected_review"] }), true);
    assert.equal(matchesRecordFilters(settled, { status: ["rejected"] }), true);
  });

  it("matches any of several values within one filter", () => {
    const leeds = view();
    assert.equal(matchesRecordFilters(leeds, { place: ["Leeds", "York"] }), true);
    assert.equal(matchesRecordFilters(leeds, { place: ["York"] }), false);
  });

  it("falls back to the postcode where a record carries no town", () => {
    const bulk = view({
      raw_payload: {
        annual_returns: [],
        charity: { charity_name: "Dales Trust", charity_contact_postcode: "LS1 4AB" },
      },
    });
    assert.equal(matchesRecordFilters(bulk, { place: ["LS1 4AB"] }), true);
  });

  it("filters on whether the record reached the client list", () => {
    const linked = describeRawRecord(
      row({ matched_organisation_id: "org-1" }),
      {
        id: "org-1",
        legalName: "Leeds Hospice",
        organisationType: null,
        sector: null,
        city: "Leeds",
        countryCode: "GB",
        outreachStatus: "not_contacted",
        website: null,
        ownerId: null,
        ownerName: null,
        ownerEmail: null,
      },
      NOW,
    );

    assert.equal(matchesRecordFilters(linked, { link: ["linked"] }), true);
    assert.equal(matchesRecordFilters(linked, { link: ["unlinked"] }), false);
    assert.equal(matchesRecordFilters(view(), { link: ["unlinked"] }), true);
  });

  it("filters on whether personal details were removed", () => {
    const stripped = view({ excluded_fields: ["contact.email"] });
    assert.equal(matchesRecordFilters(stripped, { details: ["removed"] }), true);
    assert.equal(matchesRecordFilters(stripped, { details: ["kept"] }), false);
    assert.equal(matchesRecordFilters(view(), { details: ["kept"] }), true);
  });

  it("requires every chosen filter to hold", () => {
    const record = view({ processing_status: "validated" });
    assert.equal(
      matchesRecordFilters(record, { status: ["validated"], place: ["York"] }),
      false,
    );
    assert.equal(
      matchesRecordFilters(record, { status: ["validated"], place: ["Leeds"] }),
      true,
    );
  });
});

describe("recordFilterOptions", () => {
  it("offers each value once, most common first", () => {
    const views = [
      view({ id: "a", raw_payload: { charity_name: "A", city: "Leeds" } }),
      view({ id: "b", raw_payload: { charity_name: "B", city: "York" } }),
      view({ id: "c", raw_payload: { charity_name: "C", city: "Leeds" } }),
    ];

    const options = recordFilterOptions(views, (v) =>
      v.city ? { label: v.city, value: v.city } : null,
    );

    assert.deepEqual(options, [
      { label: "Leeds", value: "Leeds" },
      { label: "York", value: "York" },
    ]);
  });

  it("offers nothing for a value no record carries", () => {
    const options = recordFilterOptions([view()], () => null);
    assert.deepEqual(options, []);
  });
});

describe("sortRecords", () => {
  const record = (name: string, overrides: Partial<RawSourceRecordRow> = {}) =>
    describeRawRecord(
      row({ id: name, raw_payload: { charity_name: name }, ...overrides }),
      null,
      NOW,
    );

  const names = (views: ReturnType<typeof record>[]) => views.map((view) => view.name);

  it("orders by name both ways", () => {
    const views = [record("Zebra Trust"), record("Acorn Fund"), record("Meadow Aid")];

    assert.deepEqual(names(sortRecords(views, "name", "asc")), [
      "Acorn Fund",
      "Meadow Aid",
      "Zebra Trust",
    ]);
    assert.deepEqual(names(sortRecords(views, "name", "desc")), [
      "Zebra Trust",
      "Meadow Aid",
      "Acorn Fund",
    ]);
  });

  it("orders by when the record was read", () => {
    const views = [
      record("Older", { received_at: "2026-08-14T09:00:00.000Z" }),
      record("Newer", { received_at: "2026-08-15T09:00:00.000Z" }),
    ];

    assert.deepEqual(names(sortRecords(views, "read", "desc")), ["Newer", "Older"]);
    assert.deepEqual(names(sortRecords(views, "read", "asc")), ["Older", "Newer"]);
  });

  it("puts what was added first and what broke last", () => {
    const views = [
      record("Broken", { processing_status: "error" }),
      record("Added", { processing_status: "validated" }),
      record("Waiting", { processing_status: "pending" }),
    ];

    assert.deepEqual(names(sortRecords(views, "outcome", "asc")), [
      "Added",
      "Waiting",
      "Broken",
    ]);
    assert.deepEqual(names(sortRecords(views, "outcome", "desc")), [
      "Broken",
      "Waiting",
      "Added",
    ]);
  });

  it("sorts a record with no town to the end whichever way the list runs", () => {
    const views = [
      record("Nowhere", { raw_payload: { charity_name: "Nowhere" } }),
      record("Leeds one", { raw_payload: { charity_name: "Leeds one", city: "Leeds" } }),
      record("York one", { raw_payload: { charity_name: "York one", city: "York" } }),
    ];

    assert.deepEqual(names(sortRecords(views, "place", "asc")), [
      "Leeds one",
      "York one",
      "Nowhere",
    ]);
    assert.deepEqual(names(sortRecords(views, "place", "desc")), [
      "York one",
      "Leeds one",
      "Nowhere",
    ]);
  });

  it("breaks a tie on the name, so the order never wobbles", () => {
    const views = [
      record("Bravo", { processing_status: "validated" }),
      record("Alpha", { processing_status: "validated" }),
    ];

    assert.deepEqual(names(sortRecords(views, "outcome", "asc")), ["Alpha", "Bravo"]);
    assert.deepEqual(names(sortRecords(views, "outcome", "desc")), ["Alpha", "Bravo"]);
  });

  it("leaves the caller's list alone", () => {
    const views = [record("Zebra Trust"), record("Acorn Fund")];
    sortRecords(views, "name", "asc");
    assert.deepEqual(names(views), ["Zebra Trust", "Acorn Fund"]);
  });
});
