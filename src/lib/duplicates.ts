/**
 * F042 — decision logic behind the duplicates admin route, kept out of the route so it
 * can be tested without a database or a request (same split as @/lib/suppressions).
 *
 * It also owns the reading the review screen is built on (`readRegisterRecord` +
 * `comparisonRows` below): an admin is asked to say whether two records are the
 * same charity, and until they could see the two records beside each other that
 * was a question answered from the incoming record's name and nothing else.
 */

import { normaliseName, normalisePostcode } from "./dedup/match-organisations.ts";
import {
  readRegisterRecord,
  type RegisterNumber,
  type RegisterRecordFacts,
} from "./dedup/register-record.ts";
import { formatCompactGbp, INCOME_BAND_LABELS, deriveIncomeBand, type IncomeBand } from "./income-band.ts";
import { formatShortDate } from "./display-format.ts";

export type MatchStatus = "pending" | "confirmed_match" | "confirmed_new" | "rejected";

/** The client side of a comparison — the fields of an ORGANISATIONS row this screen reads. */
export type CandidateOrganisationSummary = {
  legal_name: string;
  postcode: string | null;
  address_line_1: string | null;
  website: string | null;
  organisation_identifiers: { identifier_type: string; identifier_value: string }[] | null;
  financial_periods: {
    period_end: string;
    total_income: number | null;
    income_band: string | null;
    financial_source: string | null;
  }[] | null;
};

export type EntityMatchCandidateRow = {
  id: string;
  raw_source_record_id: string;
  candidate_organisation_id: string | null;
  match_score: number;
  match_method: "exact_charity_number" | "fuzzy_name" | "address_match" | "manual";
  match_status: MatchStatus;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  candidate_organisation: CandidateOrganisationSummary | null;
  // `raw_payload` is deliberately untyped: every source writes its own shape (see
  // write-organisations.ts's header) and reading it is readRegisterRecord's job,
  // not a cast at this boundary. `record_source` picks the shape; the Companies
  // House number lives in `source_record_id` rather than the payload.
  raw_source_record: {
    record_source: string;
    source_record_id: string | null;
    raw_payload: unknown;
  } | null;
  reviewed_by_user: { full_name: string | null; email: string } | null;
};

/**
 * How much of the queue one read takes: the pending set, then the most recent
 * decisions as context.
 *
 * Shared by both halves of F042's review screen — the page's initial load and
 * the GET route the panel refreshes through — because a refresh that returned a
 * different window would silently change what the reader is looking at. Set
 * once here for the same reason `ENTITY_MATCH_CANDIDATE_SELECT` lives here.
 *
 * Both bounds are deliberately small: `raw_payload` is embedded per row, which
 * makes this the heaviest per-row payload of any admin screen. The comparison
 * the pending cards render (organisation identifiers and filed financials) is
 * embedded too, so this bound is doing more work than it used to.
 */
export const PENDING_LIMIT = 200;
export const DECIDED_LIMIT = 100;

/** Shared PostgREST select, used by both the admin page's initial load and the GET route. */
export const ENTITY_MATCH_CANDIDATE_SELECT = `
  id, raw_source_record_id, candidate_organisation_id, match_score, match_method, match_status,
  reviewed_by_user_id, reviewed_at, notes, created_at,
  candidate_organisation:organisations!candidate_organisation_id (
    legal_name, postcode, address_line_1, website,
    organisation_identifiers ( identifier_type, identifier_value ),
    financial_periods ( period_end, total_income, income_band, financial_source )
  ),
  raw_source_record:raw_source_records!raw_source_record_id ( record_source, source_record_id, raw_payload ),
  reviewed_by_user:users!entity_match_candidates_reviewed_by_user_id_fkey ( full_name, email )
`;

// ─────────────────────────────────────────────────────────────────────────────
// The two records, side by side
// ─────────────────────────────────────────────────────────────────────────────
//
// An admin is asked one question per pair — same charity, or two? — and until
// these rows existed the screen answered it from the incoming record's *name*
// alone, which is the one field a duplicate is most likely to disagree on. The
// rows below are the answer: what the register published, what the client record
// holds, and where the two disagree.
//
// Read into this shape wherever the rows are read (the page and the refresh
// route), then handed to the panel as props. Reading a register payload is a
// server job — it pulls in the source mappers — and the panel is a client
// component that only renders what it is given.

const IDENTIFIER_KIND: Record<string, RegisterNumber["type"]> = {
  uk_charity: "uk_charity",
  uk_company: "uk_company",
  // Two values for one registry: profile backfill writes "companies_house",
  // while the Companies House path writes "uk_company". Both are company numbers.
  companies_house: "uk_company",
};

/** One line of the two records side by side. */
export type ComparisonRow = {
  key: "name" | "charity_number" | "company_number" | "postcode" | "address" | "website" | "income";
  /** Row label in the words of the job — never a column name. */
  label: string;
  /** The incoming record's value, as the register published it. */
  register: string | null;
  /** The client record's value. */
  client: string | null;
  /** A second line under the client's value: where its income figure came from. */
  clientNote: string | null;
  /**
   * The two sides disagree, judged by the rules the importer itself matches on
   * (or, for the fields it does not compare, on formatting-insensitive
   * equality). Only ever set when both sides have a value — an empty cell is not
   * a disagreement, it is an absence.
   */
  differs: boolean;
};

/** The client's side, read off the embedded organisation row. */
type ClientFacts = {
  name: string | null;
  numbers: RegisterNumber[];
  postcode: string | null;
  address: string | null;
  website: string | null;
  income: number | null;
  incomeBand: IncomeBand | null;
  incomeNote: string | null;
};

/**
 * A registry number's digits, leading zeros dropped: the register pads some
 * companies' numbers with a zero and stores others bare, and the same company
 * number written two ways is not a disagreement.
 */
function digitsOf(value: string): string {
  return value.replace(/[^0-9]/g, "").replace(/^0+/, "");
}

/** Case, punctuation and spacing are formatting, not a difference. */
function comparableText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** "https://www.example.org/" and "example.org" are the same website. */
function comparableWebsite(value: string): string {
  return comparableText(value)
    // Scheme first, then `www`: stripping them in the other order leaves the
    // "www" behind once the scheme in front of it is gone.
    .replace(/^https?\s+/, "")
    .replace(/^www\s+/, "")
    .replace(/\s+/g, "");
}

function readClientFacts(organisation: CandidateOrganisationSummary | null): ClientFacts | null {
  if (!organisation) return null;

  const numbers: RegisterNumber[] = [];
  for (const identifier of organisation.organisation_identifiers ?? []) {
    const type = IDENTIFIER_KIND[identifier.identifier_type];
    const value = identifier.identifier_value?.trim();
    // First one of each registry wins; a second charity number for the same
    // organisation is not something this screen has anything to say about.
    if (type && value && !numbers.some((number) => number.type === type)) {
      numbers.push({ type, value });
    }
  }

  // The latest *year end*, not the most recently written row: a charity filing
  // for an old year late must not become the client's latest figure.
  const periods = (organisation.financial_periods ?? []).filter(
    (period) => typeof period.period_end === "string" && period.period_end !== "",
  );
  const latest = periods.reduce<(typeof periods)[number] | null>(
    (newest, period) =>
      newest === null || period.period_end > newest.period_end ? period : newest,
    null,
  );

  const storedBand = latest?.income_band;
  const incomeBand =
    storedBand && storedBand in INCOME_BAND_LABELS ? (storedBand as IncomeBand) : null;

  const noteParts: string[] = [];
  // `manual` is a figure somebody typed on Add a client, not a filed return.
  // Saying so is the difference between a comparison and a false one.
  if (latest?.financial_source === "manual") noteParts.push("entered by hand");
  if (latest?.period_end) noteParts.push(`year ending ${formatShortDate(latest.period_end)}`);

  return {
    name: organisation.legal_name?.trim() || null,
    numbers,
    postcode: organisation.postcode?.trim() || null,
    address: organisation.address_line_1?.trim() || null,
    website: organisation.website?.trim() || null,
    income: typeof latest?.total_income === "number" ? latest.total_income : null,
    incomeBand,
    incomeNote: noteParts.length > 0 ? noteParts.join(" · ") : null,
  };
}

function pushRow(
  rows: ComparisonRow[],
  key: ComparisonRow["key"],
  label: string,
  register: string | null,
  client: string | null,
  differs: boolean,
  clientNote: string | null = null,
): void {
  // A row with nothing in either cell is noise — the register publishes no
  // address for a charity, so the screen simply has no Address line for it.
  if (register === null && client === null) return;
  rows.push({
    key,
    label,
    register,
    client,
    clientNote,
    differs: register !== null && client !== null && differs,
  });
}

function numberOn(facts: RegisterRecordFacts | ClientFacts | null, type: RegisterNumber["type"]) {
  return facts?.numbers.find((number) => number.type === type)?.value ?? null;
}

function comparisonRowsFrom(
  register: RegisterRecordFacts,
  organisation: CandidateOrganisationSummary | null,
): ComparisonRow[] {
  const client = readClientFacts(organisation);
  const rows: ComparisonRow[] = [];

  const registerName = register.name;
  const clientName = client?.name ?? null;
  pushRow(
    rows,
    "name",
    "Name",
    registerName,
    clientName,
    registerName !== null &&
      clientName !== null &&
      normaliseName(registerName) !== normaliseName(clientName),
  );

  // The importer's strongest key. Compared on digits alone: the register pads
  // some numbers with a leading zero and not others.
  for (const [type, key, label] of [
    ["uk_charity", "charity_number", "Charity number"],
    ["uk_company", "company_number", "Company number"],
  ] as const) {
    const registerValue = numberOn(register, type);
    const clientValue = numberOn(client, type);
    pushRow(
      rows,
      key,
      label,
      registerValue,
      clientValue,
      registerValue !== null &&
        clientValue !== null &&
        digitsOf(registerValue) !== digitsOf(clientValue),
    );
  }

  const registerPostcode = register.postcode;
  const clientPostcode = client?.postcode ?? null;
  pushRow(
    rows,
    "postcode",
    "Postcode",
    registerPostcode,
    clientPostcode,
    registerPostcode !== null &&
      clientPostcode !== null &&
      normalisePostcode(registerPostcode) !== normalisePostcode(clientPostcode),
  );

  // Not a key the importer compares, but the field a CAM is most likely to have
  // corrected by hand — or the one place the register itself has moved on.
  const registerAddress = register.address;
  const clientAddress = client?.address ?? null;
  pushRow(
    rows,
    "address",
    "Address",
    registerAddress,
    clientAddress,
    registerAddress !== null &&
      clientAddress !== null &&
      comparableText(registerAddress) !== comparableText(clientAddress),
  );

  const registerWebsite = register.website;
  const clientWebsite = client?.website ?? null;
  pushRow(
    rows,
    "website",
    "Website",
    registerWebsite,
    clientWebsite,
    registerWebsite !== null &&
      clientWebsite !== null &&
      comparableWebsite(registerWebsite) !== comparableWebsite(clientWebsite),
  );

  // Size, as a sanity check rather than a match: the same name and postcode for
  // a £25k charity and a £1.2m one is worth a second look, but a difference here
  // is normal between two filing years, so only the band is compared.
  const registerIncome = register.income;
  const clientIncome = client?.income ?? null;
  const registerBand = registerIncome === null ? null : deriveIncomeBand(registerIncome);
  const clientBand = client?.incomeBand ?? (clientIncome === null ? null : deriveIncomeBand(clientIncome));
  const clientIncomeLabel =
    clientIncome !== null
      ? formatCompactGbp(clientIncome)
      : client?.incomeBand
        ? INCOME_BAND_LABELS[client.incomeBand]
        : null;
  pushRow(
    rows,
    "income",
    "Latest income",
    registerIncome === null ? null : formatCompactGbp(registerIncome),
    clientIncomeLabel,
    registerBand !== null && clientBand !== null && registerBand !== clientBand,
    clientIncomeLabel === null ? null : client?.incomeNote ?? null,
  );

  return rows;
}

/** The two records side by side, for one flagged pair. */
export function comparisonRows(row: EntityMatchCandidateRow): ComparisonRow[] {
  return comparisonRowsFrom(readRegisterFacts(row), row.candidate_organisation);
}

function readRegisterFacts(row: EntityMatchCandidateRow): RegisterRecordFacts {
  return readRegisterRecord({
    rawPayload: row.raw_source_record?.raw_payload ?? null,
    recordSource: row.raw_source_record?.record_source ?? null,
    sourceRecordId: row.raw_source_record?.source_record_id ?? null,
  });
}

/** What a nameless incoming record is called when nothing readable on it is a name. */
export const UNNAMED_RECORD = "Name not recorded";

/**
 * One row as the screen needs it: the flag, plus the incoming record's name.
 *
 * The name is read here rather than in the panel because reading it means
 * knowing which source wrote the payload — the name of a bulk register record is
 * nested under `charity`, and a panel that read only the top level showed every
 * one of those rows as "Name not recorded".
 */
export type QueueRecord = {
  row: EntityMatchCandidateRow;
  name: string;
};

/** A pending flag, with both records read out for the comparison. */
export type PendingReview = QueueRecord & { comparison: ComparisonRow[] };

export function toQueueRecord(row: EntityMatchCandidateRow): QueueRecord {
  return { row, name: readRegisterFacts(row).name ?? UNNAMED_RECORD };
}

export function toPendingReview(row: EntityMatchCandidateRow): PendingReview {
  const facts = readRegisterFacts(row);
  return {
    row,
    name: facts.name ?? UNNAMED_RECORD,
    comparison: comparisonRowsFrom(facts, row.candidate_organisation),
  };
}

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "The decision could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from decide_duplicate_flag onto something safe to show an
 * admin. Every errcode below is one the RPC raises deliberately, with a message
 * written to be read by an admin (see 20260809150000_create_entity_match_candidates.sql)
 * — no table or constraint names, nothing internal. Passing those through is safe;
 * everything else gets the generic string (DoD: no stack traces or internals in a
 * user-facing error).
 */
export function duplicateRpcFailure(error: { code?: string; message?: string }): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: GENERIC_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "55000":
      return { status: 409, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}
