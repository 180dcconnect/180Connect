// What the incoming register record says about the charity it describes.
//
// F042's review screen shows an admin two records side by side before they say
// whether they are the same charity. The right-hand one is an `organisations`
// row, which needs no reading — it is already in the shape the app stores. This
// module is the left-hand one: the raw record the import held back.
//
// ── Why it exists ──
//
// Every source writes its own payload shape (write-organisations.ts's header
// lists them), so a screen that read one shape showed every other source's rows
// as nameless. Six of the seven fields below were on every one of those records
// the whole time; nothing was reading them. Reading a payload is one job, done
// once, here — not a `??` chain in a component.
//
// ── Why it reads the payload the way each mapper does ──
//
// The point of the left column is that it can be compared with the right one.
// So each field is read the way *that source's mapper* would store it: the
// address through the mapper's own splitter (reused, not reimplemented — a
// reader that ordered the register's five address lines differently would make
// every pair look like it disagreed), numbers as published, income as the
// register files it. If a client came from the same register import and nobody
// has edited it, the two columns read alike; a difference on screen is then a
// real difference rather than an artefact of this module.
//
// Contact email and phone are deliberately not read. The data-handling backfill
// redacts personal contact details out of these payloads, and re-publishing one
// on an admin screen is the opposite of that policy. They are also not identity:
// a charity's inbox changes, its registration number does not.
//
// Pure, no I/O, no database — same split as match-organisations.ts next door, so
// the screen's left-hand column can be tested from a payload literal.

import { splitCharityCommissionAddress } from "../standardize/charity-commission.ts";
import {
  splitBulkAddress,
  type RawCharityCommissionBulkRecord,
} from "../standardize/charity-commission-bulk.ts";

/** A registry number, tagged with the registry the register itself says it belongs to. */
export type RegisterNumber = {
  type: "uk_charity" | "uk_company";
  /** As the register publishes it. Formatting (padding, spaces) is not normalised here. */
  value: string;
};

/** The incoming record, in the fields a person compares two charities on. */
export type RegisterRecordFacts = {
  name: string | null;
  numbers: RegisterNumber[];
  postcode: string | null;
  /** The first line of the address, as the mapper would store it. */
  address: string | null;
  website: string | null;
  /** The register's latest filed income, in whole pounds. */
  income: number | null;
};

export type RegisterRecordInput = {
  rawPayload: unknown;
  /** `raw_source_records.record_source` — decides which payload shape this is. */
  recordSource: string | null;
  /** `raw_source_records.source_record_id` — the Companies House number, which lives here and not in the payload. */
  sourceRecordId: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A trimmed non-empty string, or a finite number as its digits, or null. */
function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** The first value that says something, in the caller's order of preference. */
function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return null;
}

/** "1,250,000" / "£1250000" / 1250000 all mean the same figure to the register's exporters. */
function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberEntry(type: RegisterNumber["type"], value: unknown): RegisterNumber | null {
  const number = text(value);
  return number ? { type, value: number } : null;
}

function compact(numbers: (RegisterNumber | null)[]): RegisterNumber[] {
  return numbers.filter((number): number is RegisterNumber => number !== null);
}

/**
 * The Charity Commission's bulk register extract. Everything is nested under
 * `charity` — which is why the name read as "not recorded" until this module
 * existed: `raw_payload.charity_name` is null on every bulk record, because the
 * name is at `raw_payload.charity.charity_name`.
 */
function readBulkRegister(payload: Record<string, unknown>): RegisterRecordFacts {
  const charity = (asObject(payload.charity) ?? {}) as RawCharityCommissionBulkRecord["charity"];
  const address = splitBulkAddress(charity);

  return {
    name: firstText(charity.charity_name),
    numbers: compact([
      numberEntry("uk_charity", charity.registered_charity_number),
      numberEntry("uk_company", charity.charity_company_registration_number),
    ]),
    postcode: firstText(charity.charity_contact_postcode),
    address: firstText(address.addressLine1),
    website: firstText(charity.charity_contact_web),
    income: asNumber((charity as { latest_income?: unknown }).latest_income),
  };
}

/**
 * Companies House. The number is on the payload and also in `source_record_id`
 * (the write path normalises that one into the identifier, so it is the fallback
 * rather than the first choice), and the registered office address is where its
 * address fields live.
 */
function readCompaniesHouse(payload: Record<string, unknown>): RegisterRecordFacts {
  const address = asObject(payload.registered_office_address) ?? {};

  return {
    name: firstText(payload.company_name),
    numbers: compact([numberEntry("uk_company", payload.company_number)]),
    postcode: firstText(address.postal_code),
    address: firstText(address.address_line_1),
    website: null,
    income: null,
  };
}

/**
 * Find That Charity's reconciled candidate. Its payload carries a *label*
 * (`Oxfam (GB-CHC-202918) [INACTIVE]`) and the name we searched with; the mapper
 * stores the searched name (standardizeFindThatCharityRecord), so that is what
 * this record is called here. Its registry id is the only number on it, and only
 * GB-CHC is a Charity Commission number — see findThatCharityRegistrationNumbers
 * in write-organisations.ts for why GB-NIC/GB-SC are left alone.
 */
function readFindThatCharity(payload: Record<string, unknown>): RegisterRecordFacts {
  const id = text(payload.id);
  const match = id ? /^GB-CHC-(.+)$/.exec(id) : null;

  return {
    name: firstText(payload.queried_name, payload.name),
    numbers: compact([match ? { type: "uk_charity", value: match[1] } : null]),
    postcode: null,
    address: null,
    website: null,
    income: null,
  };
}

/**
 * The Charity Commission's live API, and anything else a future source writes
 * flat. Field names are the ones the API publishes: `reg_charity_number`,
 * `address_line_one…five`, `address_post_code`, `web`, `latest_income`.
 */
function readFlatRegister(payload: Record<string, unknown>): RegisterRecordFacts {
  const address = splitCharityCommissionAddress(
    payload as Parameters<typeof splitCharityCommissionAddress>[0],
  );
  const registeredOffice = asObject(payload.registered_office_address) ?? {};

  return {
    name: firstText(payload.charity_name, payload.company_name, payload.name, payload.legal_name),
    numbers: compact([
      numberEntry(
        "uk_charity",
        firstText(payload.reg_charity_number, payload.registered_charity_number),
      ),
      numberEntry(
        "uk_company",
        firstText(
          payload.charity_co_reg_number,
          payload.charity_company_registration_number,
          payload.company_number,
        ),
      ),
    ]),
    postcode: firstText(payload.address_post_code, payload.postcode, registeredOffice.postal_code),
    address: firstText(
      address.addressLine1,
      payload.address_line_1,
      registeredOffice.address_line_1,
    ),
    website: firstText(payload.web, payload.website, payload.website_url),
    income: asNumber(payload.latest_income ?? payload.total_income),
  };
}

/** Reads one incoming record into the fields the review screen shows. Never throws on a payload. */
export function readRegisterRecord(input: RegisterRecordInput): RegisterRecordFacts {
  const payload = asObject(input.rawPayload) ?? {};

  switch (input.recordSource) {
    case "charity_commission_bulk":
      return readBulkRegister(payload);
    case "companies_house": {
      const facts = readCompaniesHouse(payload);
      // The number the write path stores comes from source_record_id, which is
      // set for records whose payload predates company_number being carried.
      if (facts.numbers.length === 0) {
        const fallback = numberEntry("uk_company", input.sourceRecordId);
        if (fallback) facts.numbers.push(fallback);
      }
      return facts;
    }
    case "find_that_charity":
      return readFindThatCharity(payload);
    default:
      return readFlatRegister(payload);
  }
}
