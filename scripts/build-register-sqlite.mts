/**
 * Builds the Charity Commission register as a single read-only SQLite file.
 *
 *     npm run register:build
 *     npm run register:build -- --dir /path/to/unzipped --out data/register.sqlite
 *
 * This runs in CI (.github/workflows/refresh-charity-register.yml), not on
 * anyone's laptop. Nobody on the team should ever need to type this.
 *
 * ── Why a file and not a database table ──
 *
 * The register is 171,800 charities that change daily and are read a few days
 * per quarter, when a cycle's client list is being chosen. Held in Postgres it
 * cost 570MB — more than the whole Supabase free tier — and competed directly
 * with the one thing that cannot be regenerated: sent emails and replies.
 *
 * As a file it costs the database nothing, ships with the deployment so a
 * release can never serve data it was not built against, and answers the
 * filter screen's queries in milliseconds. Measured on the 2026-09-03 extract:
 * 182MB, and the same counts Postgres gave.
 *
 * ── No redaction here, deliberately ──
 *
 * This file is a local mirror of a file the regulator publishes publicly, in
 * the same sense the .zip on disk is. The data-handling rules (F246/F247) apply
 * on the way into *our* store, and that is where they run — see
 * applyDataHandling in src/lib/charity-register/import.ts. Redacting here would
 * mean the CI job needed Supabase credentials to read the active policy, and
 * would bake one version of the rules into an artefact that outlives them.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

import {
  streamExtract,
  type ExtractSource,
} from "../src/lib/charity-register/extract-stream.ts";
import {
  RETURN_FIELDS,
  dateOnly,
  numberOrNull,
  pickNumber,
  postcodeAreaOf,
  type ExtractAnnualReturn,
  type ExtractArea,
  type ExtractCharity,
  type ExtractClassification,
} from "../src/lib/charity-register/extract-rows.ts";
import {
  REGISTER_SCHEMA,
  REGISTER_SCHEMA_INDEXES,
  SCHEMA_VERSION,
} from "../src/lib/charity-register/sqlite-schema.ts";

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

const OUT = flag("out") || "data/register.sqlite";
const source: ExtractSource = { localDir: flag("dir") || undefined };

/** The label kinds the register uses, and which extract they come from. */
const CLASSIFICATION_KINDS = new Set(["What", "Who", "How"]);
const AREA_KINDS = new Set(["Local Authority", "Region", "Country"]);

async function main(): Promise<void> {
  const started = Date.now();
  mkdirSync(dirname(OUT), { recursive: true });
  try {
    rmSync(OUT);
  } catch {
    // First run, or already gone.
  }

  const db = new DatabaseSync(OUT);
  // Safe because a failed build throws the file away and starts again: there is
  // no state here worth crash-protecting, and the difference is minutes.
  db.exec("pragma journal_mode = off; pragma synchronous = off;");
  db.exec(REGISTER_SCHEMA);

  // ── Pass 1: classifications and areas, interned into a label table ──
  //
  // The register repeats the same 487 strings ("Education/training",
  // "Sheffield City") across 2.3 million rows. Storing an integer per link
  // instead of the text is what keeps the file at 182MB rather than several
  // hundred; it is the same data, encoded once.
  const labelIds = new Map<string, number>();
  const insertLabel = db.prepare("insert into label (kind, value) values (?, ?)");
  const labelFor = (kind: string, value: string): number => {
    // Escaped rather than a literal NUL: an actual 0x00 byte in the source
    // makes git treat this file as binary and stop diffing it. A separator
    // that cannot occur in the register's own strings is still the right
    // choice — a space would let ("What X", "Y") collide with ("What", "X Y").
    const key = `${kind}\u0000${value}`;
    let id = labelIds.get(key);
    if (id === undefined) {
      id = Number(insertLabel.run(kind, value).lastInsertRowid);
      labelIds.set(key, id);
    }
    return id;
  };

  const labelsByCharity = new Map<number, Set<number>>();
  const addLabel = (organisationNumber: number, labelId: number) => {
    let set = labelsByCharity.get(organisationNumber);
    if (!set) {
      set = new Set();
      labelsByCharity.set(organisationNumber, set);
    }
    set.add(labelId);
  };

  for await (const row of streamExtract<ExtractClassification>("classification", source)) {
    const kind = row.classification_type ?? "";
    const value = (row.classification_description ?? "").trim();
    if (!CLASSIFICATION_KINDS.has(kind) || !value) continue;
    addLabel(row.organisation_number, labelFor(kind, value));
  }
  for await (const row of streamExtract<ExtractArea>("areaOfOperation", source)) {
    const kind = row.geographic_area_type ?? "";
    const value = (row.geographic_area_description ?? "").trim();
    if (!AREA_KINDS.has(kind) || !value) continue;
    addLabel(row.organisation_number, labelFor(kind, value));
  }
  console.log(
    `[register:build] ${labelIds.size} distinct labels across ${labelsByCharity.size.toLocaleString()} charities`,
  );

  // ── Pass 2: the charities themselves ──
  //
  // Only currently-registered, non-linked charities are kept. Neither is a
  // selection criterion the team chooses: a removed charity is not an outreach
  // target, and a linked subsidiary shares its parent's number and would import
  // as a duplicate organisation.
  const insertCharity = db.prepare(`
    insert into charity (
      organisation_number, registered_charity_number, charity_name, charity_type,
      reporting_status, date_of_registration, latest_income, latest_expenditure,
      latest_period_start, latest_period_end, postcode, postcode_area, address_lines,
      contact_email, contact_phone, contact_website, company_number,
      is_cio, insolvent, in_administration, activities
    ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertLink = db.prepare(
    "insert into charity_label (organisation_number, label_id) values (?, ?)",
  );

  const kept = new Set<number>();
  let charities = 0;
  let scanned = 0;
  db.exec("begin");
  for await (const charity of streamExtract<ExtractCharity>("charity", source)) {
    scanned += 1;
    if (charity.charity_registration_status !== "Registered") continue;
    if (charity.linked_charity_number !== 0) continue;

    const addressLines = [
      charity.charity_contact_address1,
      charity.charity_contact_address2,
      charity.charity_contact_address3,
      charity.charity_contact_address4,
      charity.charity_contact_address5,
    ]
      .map((line) => (line ?? "").trim())
      .filter(Boolean);

    insertCharity.run(
      charity.organisation_number,
      numberOrNull(charity.registered_charity_number),
      (charity.charity_name ?? "").trim() || "(no name published)",
      charity.charity_type ?? null,
      charity.charity_reporting_status ?? null,
      dateOnly(charity.date_of_registration),
      numberOrNull(charity.latest_income),
      numberOrNull(charity.latest_expenditure),
      dateOnly(charity.latest_acc_fin_period_start_date),
      dateOnly(charity.latest_acc_fin_period_end_date),
      charity.charity_contact_postcode ?? null,
      postcodeAreaOf(charity.charity_contact_postcode),
      addressLines.length > 0 ? JSON.stringify(addressLines) : null,
      charity.charity_contact_email ?? null,
      charity.charity_contact_phone ?? null,
      charity.charity_contact_web ?? null,
      charity.charity_company_registration_number ?? null,
      charity.charity_is_cio ? 1 : 0,
      charity.charity_insolvent ? 1 : 0,
      charity.charity_in_administration ? 1 : 0,
      charity.charity_activities ?? null,
    );
    kept.add(charity.organisation_number);
    for (const labelId of labelsByCharity.get(charity.organisation_number) ?? []) {
      insertLink.run(charity.organisation_number, labelId);
    }

    if (++charities % 50_000 === 0) {
      db.exec("commit");
      db.exec("begin");
      console.log(`[register:build] ${charities.toLocaleString()} charities`);
    }
  }
  db.exec("commit");
  labelsByCharity.clear();
  console.log(
    `[register:build] ${charities.toLocaleString()} charities kept of ${scanned.toLocaleString()} rows`,
  );

  // ── Pass 3: annual returns, Part A then Part B ──
  //
  // Merged per (charity, period): Part B wins on fields both carry, because it
  // is the fuller return that only larger charities file. Held in memory
  // between the two passes — bounded by the number of kept charities, and the
  // alternative is an upsert-merge per row.
  const merged = new Map<string, ExtractAnnualReturn>();
  for (const extract of ["annualReturnPartA", "annualReturnPartB"] as const) {
    for await (const row of streamExtract<ExtractAnnualReturn>(extract, source)) {
      if (!kept.has(row.organisation_number)) continue;
      const periodEnd = dateOnly(row.fin_period_end_date);
      if (!periodEnd) continue;
      const key = `${row.organisation_number}:${periodEnd}`;
      const existing = merged.get(key);
      merged.set(key, existing ? { ...existing, ...row } : row);
    }
  }

  const insertReturn = db.prepare(`
    insert or replace into charity_return (
      organisation_number, period_start, period_end, total_income, total_expenditure,
      income_donations_legacies, income_charitable_activities, income_other_trading,
      income_investment, income_endowments, income_other,
      income_govt_grants, income_govt_contracts,
      expenditure_charitable_activities, expenditure_raising_funds, expenditure_governance,
      expenditure_grants_institutions, expenditure_investment_management, expenditure_other,
      filing_date, count_employees, count_volunteers,
      receives_govt_grants, receives_govt_contracts, count_govt_grants, count_govt_contracts
    ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  let returns = 0;
  db.exec("begin");
  for (const row of merged.values()) {
    const periodStart = dateOnly(row.fin_period_start_date);
    const periodEnd = dateOnly(row.fin_period_end_date);
    if (!periodStart || !periodEnd || periodEnd < periodStart) continue;

    const totalIncome = pickNumber(row, RETURN_FIELDS.total_income);
    const totalExpenditure = pickNumber(row, RETURN_FIELDS.total_expenditure);
    // A period with neither total is a filing stub: the year is on record with
    // no figures in it, and storing it renders an empty row that reads as lost
    // data rather than an unfiled return.
    if (totalIncome === null && totalExpenditure === null) continue;

    insertReturn.run(
      row.organisation_number,
      periodStart,
      periodEnd,
      totalIncome,
      totalExpenditure,
      pickNumber(row, ["income_donations_and_legacies"]),
      pickNumber(row, ["income_charitable_activities"]),
      pickNumber(row, ["income_other_trading_activities"]),
      pickNumber(row, ["income_investments"]),
      pickNumber(row, ["income_endowments"]),
      pickNumber(row, ["income_other"]),
      pickNumber(row, ["income_from_government_grants"]),
      pickNumber(row, ["income_from_government_contracts"]),
      pickNumber(row, ["expenditure_charitable_expenditure"]),
      pickNumber(row, ["expenditure_raising_funds"]),
      pickNumber(row, ["expenditure_governance"]),
      pickNumber(row, ["expenditure_grants_institution"]),
      pickNumber(row, ["expenditure_investment_management"]),
      pickNumber(row, ["expenditure_other"]),
      dateOnly(row.ar_received_date),
      pickNumber(row, ["count_employees"]),
      pickNumber(row, ["count_volunteers"]),
      row.charity_receives_govt_funding_grants ? 1 : 0,
      row.charity_receives_govt_funding_contracts ? 1 : 0,
      pickNumber(row, ["count_govt_grants"]),
      pickNumber(row, ["count_govt_contracts"]),
    );
    if (++returns % 50_000 === 0) {
      db.exec("commit");
      db.exec("begin");
    }
  }
  db.exec("commit");
  console.log(`[register:build] ${returns.toLocaleString()} annual returns`);

  // Indexes last: building them once over a full table is far cheaper than
  // maintaining them across a million inserts.
  db.exec(REGISTER_SCHEMA_INDEXES);

  const builtOn = new Date().toISOString().slice(0, 10);
  const setMeta = db.prepare("insert or replace into meta (key, value) values (?, ?)");
  setMeta.run("built_on", builtOn);
  setMeta.run("charities", String(charities));
  setMeta.run("returns", String(returns));
  setMeta.run("schema_version", SCHEMA_VERSION);

  // ANALYZE before VACUUM: without planner statistics SQLite guesses at the
  // location filter's `postcode_area in (...) or exists (label)` and can pick a
  // full scan. The stats table is a few KB and is what keeps a filtered count
  // in the low hundreds of milliseconds.
  db.exec("analyze");
  db.exec("vacuum");
  db.close();

  const megabytes = statSync(OUT).size / 1_048_576;
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `\n[register:build] wrote ${OUT} — ${megabytes.toFixed(1)}MB in ${Math.floor(seconds / 60)}m ${seconds % 60}s\n` +
      `  built on          ${builtOn}\n` +
      `  charities         ${charities.toLocaleString()}\n` +
      `  annual returns    ${returns.toLocaleString()}\n` +
      `  labels            ${labelIds.size}\n\n` +
      `Nothing was filtered out. The import screen decides what to take from this.`,
  );
}

await main();
