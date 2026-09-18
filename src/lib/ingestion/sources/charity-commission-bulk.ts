// Charity Commission bulk register import.
//
// Discovery (charity-commission.ts) searches the register *forward from a
// registration watermark*: it finds charities registered since the last run,
// which is the one cohort guaranteed to have filed no accounts yet. That is why
// FINANCIAL_PERIODS covered 5 organisations of 1,947, and why organisations.sector
// was empty for every row. This adapter asks the opposite question — which of the
// 185,574 charities already on the register are worth approaching — and answers it
// from the daily bulk extract, which carries the accounts and the classification
// in the same download.
//
// ── Why this fits the DataSourceAdapter contract at all ──
//
// runIngestion holds an adapter's whole result in memory, and the extract is
// 508MB of charities, 1.26GB of annual returns. Neither fits. What fits is the
// *filtered* result: today's whitelist selects 4,704 charities, about 5MB of
// records. So the filter runs inside fetch(), while streaming, and only matches
// are ever materialised. That keeps the three things runIngestion does for us:
// checksum dedup, ingestion_runs bookkeeping, and — the one that matters —
// applyDataHandling, which redacts personal email addresses out of the 149,590
// payloads that carry one. Anything that ever moves this work outside the runner
// must call applyDataHandling itself (see apply-data-handling.ts's header).
//
// ── Streaming shape ──
//
// Each extract is a JSON array printed one object per line: "[{…}" then ",{…}"
// then "…}]". So the parser is readline plus a stripped leading comma — no
// streaming JSON parser, constant memory, and a malformed line costs one record
// rather than the run. Verified against the live files on 2026-09-02.
//
// The zips are read with fflate's streaming Unzip: Node's zlib does gzip, not
// zip archives, and buffering a 508MB member to call a one-shot unzip would put
// back the memory problem this design exists to avoid.

import { Unzip, UnzipInflate } from "fflate";

import type { CommonRecord, DataSourceAdapter, SourceFetchResult } from "../type.ts";
import { fetchWithRetry } from "./charity-commission.ts";
import {
  CLASSIFICATION_TO_SECTOR,
  EXTRACTS,
  EXTRACT_BASE_URL,
  MIN_INCOME,
  PRIORITY_LOCAL_AUTHORITIES,
  isPriorityPostcode,
  type ExtractName,
} from "./charity-commission-bulk-config.ts";

/** One row of publicextract.charity — only the fields the filter and mapper read. */
export type BulkCharityRow = {
  organisation_number: number;
  registered_charity_number: number;
  linked_charity_number: number;
  charity_name: string | null;
  charity_type: string | null;
  charity_registration_status: string | null;
  charity_reporting_status: string | null;
  date_of_registration: string | null;
  latest_income: number | null;
  latest_expenditure: number | null;
  latest_acc_fin_period_start_date: string | null;
  latest_acc_fin_period_end_date: string | null;
  charity_contact_address1: string | null;
  charity_contact_address2: string | null;
  charity_contact_address3: string | null;
  charity_contact_address4: string | null;
  charity_contact_address5: string | null;
  charity_contact_postcode: string | null;
  charity_contact_phone: string | null;
  charity_contact_email: string | null;
  charity_contact_web: string | null;
  charity_company_registration_number: string | null;
  charity_is_cio: boolean | null;
  charity_activities: string | null;
};

/** A row of either annual-return extract, keyed by charity and period. */
export type BulkAnnualReturnRow = Record<string, unknown> & {
  organisation_number: number;
  fin_period_start_date?: string | null;
  fin_period_end_date?: string | null;
};

/** What one accepted charity becomes: the register row plus everything we joined. */
export type BulkCharityPayload = {
  charity: BulkCharityRow;
  /** Merged Part A + Part B rows, one per financial period. */
  annual_returns: BulkAnnualReturnRow[];
  /** "What the charity does" descriptions that matched our sector map. */
  matched_classifications: string[];
  /** The branch local authorities this charity says it operates in. */
  matched_areas: string[];
};

/**
 * The accept/reject funnel, recorded on the run (`ingestion_runs.run_stats`) so
 * the admin page can show how 185,574 charities became the number that was
 * imported, and so a filter widened by accident is visible as a step change
 * between two runs rather than as a client list nobody can explain.
 *
 * Cumulative: each stage counts the rows that passed every gate up to and
 * including it, so consecutive stages read as "and then this many survived".
 */
export type BulkImportStats = {
  /** Every row in publicextract.charity, whether or not it was a candidate. */
  charitiesScanned: number;
  /** Registration status "Registered", and not a linked subsidiary row. */
  registered: number;
  /** …and at or above MIN_INCOME. */
  passedIncome: number;
  /** …and classified into one of the accepted sectors. */
  passedSector: number;
  /** …and local to the branch. The imported set. */
  accepted: number;
  /** Annual-return rows joined onto the accepted set, across Part A and Part B. */
  annualReturnRows: number;
};

/**
 * The gates `acceptCharity` applies, in the order it applies them. The funnel
 * is derived from this rather than from a second set of conditions, so a stage
 * cannot drift out of step with the predicate it is supposed to describe.
 */
const GATE_ORDER = ["not_registered", "linked", "income", "sector", "area"] as const;

export type BulkAdapterOptions = {
  /**
   * Read the extracts from a directory of already-unzipped .json files instead
   * of downloading them. For tests, and for a second run in a day without
   * pulling 100MB again.
   */
  localDir?: string;
  /** Stop after this many accepted charities. For a first, capped run. */
  limit?: number;
  /** Called once the streaming passes are done, before records are returned. */
  onStats?: (stats: BulkImportStats) => void;
};

const DECODER = new TextDecoder();

/**
 * Streams one extract's lines.
 *
 * Yields the JSON text of each element, leading "[" / "," and trailing "]"
 * stripped. Lines are assembled across chunk boundaries — a 508MB file does not
 * arrive on tidy line boundaries, and a record split across two chunks would
 * otherwise be silently dropped.
 */
async function* streamExtractLines(
  name: ExtractName,
  options: BulkAdapterOptions,
): AsyncGenerator<string> {
  const file = EXTRACTS[name];

  if (options.localDir) {
    const { createReadStream } = await import("node:fs");
    const { createInterface } = await import("node:readline");
    const stream = createReadStream(`${options.localDir}/${file}.json`, {
      encoding: "utf8",
    });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      const trimmed = trimElement(line);
      if (trimmed) yield trimmed;
    }
    return;
  }

  const response = await fetchWithRetry(`${EXTRACT_BASE_URL}/${file}.zip`, {});
  if (!response.ok || !response.body) {
    throw new Error(
      `Charity Commission extract ${file}.zip returned ${response.status}`,
    );
  }

  // fflate's Unzip is push-based and the fetch body is pull-based, so the
  // decompressed lines land in a queue that the generator drains between
  // chunks. Nothing accumulates beyond one chunk's worth of lines.
  const queue: string[] = [];
  let pending = "";
  let failure: Error | null = null;

  const unzip = new Unzip((entry) => {
    // The archive holds exactly one .json member; anything else is skipped
    // rather than parsed as if it were the register.
    if (!entry.name.endsWith(".json")) return;
    entry.ondata = (err, chunk, final) => {
      if (err) {
        failure = err instanceof Error ? err : new Error(String(err));
        return;
      }
      pending += DECODER.decode(chunk, { stream: !final });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = trimElement(line);
        if (trimmed) queue.push(trimmed);
      }
      if (final && pending) {
        const trimmed = trimElement(pending);
        if (trimmed) queue.push(trimmed);
        pending = "";
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (value) unzip.push(value, done);
    if (failure) throw failure;
    while (queue.length > 0) yield queue.shift()!;
    if (done) break;
  }
  while (queue.length > 0) yield queue.shift()!;
}

/** Strips the array punctuation a line carries, or returns "" for a non-element. */
function trimElement(line: string): string {
  // The BOM is only on the first line, and only the first line starts with "[".
  const text = line.replace(/^﻿/, "").trim();
  const body = text.startsWith("[") ? text.slice(1) : text.startsWith(",") ? text.slice(1) : text;
  const withoutTail = body.endsWith("]") ? body.slice(0, -1) : body;
  const trimmed = withoutTail.trim().replace(/,$/, "");
  return trimmed.startsWith("{") ? trimmed : "";
}

/** Parses a line, or returns null — one bad row must not end a 400k-row pass. */
function parseRow<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

/**
 * Charities whose "What the charity does" classification we accept, and the
 * sector each maps to. Built in one pass over the classification extract.
 */
async function loadSectorMembership(
  options: BulkAdapterOptions,
): Promise<Map<number, string[]>> {
  const byOrganisation = new Map<number, string[]>();
  for await (const line of streamExtractLines("classification", options)) {
    const row = parseRow<{
      organisation_number: number;
      classification_type: string | null;
      classification_description: string | null;
    }>(line);
    if (!row || row.classification_type !== "What") continue;
    const description = row.classification_description ?? "";
    if (!(description in CLASSIFICATION_TO_SECTOR)) continue;
    const existing = byOrganisation.get(row.organisation_number);
    if (existing) existing.push(description);
    else byOrganisation.set(row.organisation_number, [description]);
  }
  return byOrganisation;
}

/** Charities the register says operate in one of the branch's local authorities. */
async function loadAreaMembership(
  options: BulkAdapterOptions,
): Promise<Map<number, string[]>> {
  const wanted = new Set(
    PRIORITY_LOCAL_AUTHORITIES.map((name) => name.trim().toLowerCase()),
  );
  const byOrganisation = new Map<number, string[]>();
  for await (const line of streamExtractLines("areaOfOperation", options)) {
    const row = parseRow<{
      organisation_number: number;
      geographic_area_type: string | null;
      geographic_area_description: string | null;
    }>(line);
    if (!row) continue;
    const description = (row.geographic_area_description ?? "").trim();
    if (!wanted.has(description.toLowerCase())) continue;
    const existing = byOrganisation.get(row.organisation_number);
    if (existing) existing.push(description);
    else byOrganisation.set(row.organisation_number, [description]);
  }
  return byOrganisation;
}

/**
 * Whether a register row is a charity we want, and why not when it is not.
 *
 * Exported for its own tests: this predicate decides how big the book gets, and
 * it is the one piece of this file worth being able to assert on directly.
 */
export function acceptCharity(
  row: BulkCharityRow,
  sectors: Map<number, string[]>,
  areas: Map<number, string[]>,
): { accepted: boolean; reason?: "not_registered" | "linked" | "income" | "sector" | "area" } {
  if (row.charity_registration_status !== "Registered") {
    return { accepted: false, reason: "not_registered" };
  }
  // Linked entries are a charity's subsidiary rows, sharing a registered number
  // with their parent. 13,780 of them: importing both would create duplicate
  // organisations the dedup pass then has to unpick.
  if (row.linked_charity_number !== 0) return { accepted: false, reason: "linked" };
  if (row.latest_income === null || row.latest_income < MIN_INCOME) {
    return { accepted: false, reason: "income" };
  }
  if (!sectors.has(row.organisation_number)) return { accepted: false, reason: "sector" };
  const local =
    areas.has(row.organisation_number) || isPriorityPostcode(row.charity_contact_postcode);
  if (!local) return { accepted: false, reason: "area" };
  return { accepted: true };
}

/**
 * Annual returns for the accepted charities, Part A and Part B merged per
 * financial period.
 *
 * Two extracts because the Commission splits the return: Part A carries
 * volunteers, the government-funding questions and the totals; Part B carries
 * the full SOFA, the balance sheet and the employee count, and only for the
 * larger charities that file full accounts (79k rows against Part A's 662k).
 * They are keyed identically, so a period present in both becomes one row.
 */
async function loadAnnualReturns(
  wanted: Set<number>,
  options: BulkAdapterOptions,
): Promise<{ rows: Map<number, BulkAnnualReturnRow[]>; count: number }> {
  const byOrganisation = new Map<number, Map<string, BulkAnnualReturnRow>>();
  let count = 0;

  for (const extract of ["annualReturnPartA", "annualReturnPartB"] as const) {
    for await (const line of streamExtractLines(extract, options)) {
      const row = parseRow<BulkAnnualReturnRow>(line);
      if (!row || !wanted.has(row.organisation_number)) continue;
      const key = String(row.fin_period_end_date ?? "").slice(0, 10);
      if (!key) continue;
      const periods =
        byOrganisation.get(row.organisation_number) ??
        new Map<string, BulkAnnualReturnRow>();
      const existing = periods.get(key);
      // Part B wins on the fields both carry: it is the fuller return. Part A's
      // values survive for everything Part B does not publish.
      periods.set(key, existing ? { ...existing, ...row } : row);
      byOrganisation.set(row.organisation_number, periods);
      count += 1;
    }
  }

  const rows = new Map<number, BulkAnnualReturnRow[]>();
  for (const [organisationNumber, periods] of byOrganisation) {
    rows.set(
      organisationNumber,
      [...periods.values()].sort((a, b) =>
        String(a.fin_period_end_date).localeCompare(String(b.fin_period_end_date)),
      ),
    );
  }
  return { rows, count };
}

/**
 * The adapter. One CommonRecord per accepted charity, carrying the register row
 * and everything joined to it, so the standardize layer never has to go back to
 * the extracts.
 */
export function createCharityCommissionBulkAdapter(
  options: BulkAdapterOptions = {},
): DataSourceAdapter {
  return {
    name: "charity_commission_bulk",

    async fetch(): Promise<SourceFetchResult> {
      const sectors = await loadSectorMembership(options);
      const areas = await loadAreaMembership(options);

      const stats: BulkImportStats = {
        charitiesScanned: 0,
        registered: 0,
        passedIncome: 0,
        passedSector: 0,
        accepted: 0,
        annualReturnRows: 0,
      };

      const accepted = new Map<number, BulkCharityRow>();
      let truncated = false;

      for await (const line of streamExtractLines("charity", options)) {
        const row = parseRow<BulkCharityRow>(line);
        if (!row) continue;
        stats.charitiesScanned += 1;

        const verdict = acceptCharity(row, sectors, areas);

        // Which gate this row died at, as an index into GATE_ORDER — or past the
        // end when it passed all of them. A stage counts the row when the row got
        // further than that stage's gate, which is what makes the funnel
        // cumulative and keeps it honest against acceptCharity's real order.
        const failedAt = verdict.reason
          ? GATE_ORDER.indexOf(verdict.reason)
          : GATE_ORDER.length;
        if (failedAt > 1) stats.registered += 1;
        if (failedAt > 2) stats.passedIncome += 1;
        if (failedAt > 3) stats.passedSector += 1;

        if (!verdict.accepted) continue;

        if (options.limit !== undefined && accepted.size >= options.limit) {
          // A capped run is a partial run, and runIngestion records it as such
          // rather than as a complete sweep that happened to find fewer.
          truncated = true;
          break;
        }
        accepted.set(row.organisation_number, row);
        stats.accepted += 1;
      }

      const { rows: annualReturns, count } = await loadAnnualReturns(
        new Set(accepted.keys()),
        options,
      );
      stats.annualReturnRows = count;
      options.onStats?.(stats);

      const records: CommonRecord[] = [];
      for (const [organisationNumber, charity] of accepted) {
        const payload: BulkCharityPayload = {
          charity,
          annual_returns: annualReturns.get(organisationNumber) ?? [],
          matched_classifications: sectors.get(organisationNumber) ?? [],
          matched_areas: areas.get(organisationNumber) ?? [],
        };
        records.push({
          // The register's own stable key, and the same one the API source uses
          // for its own records — but under a different record_source, so the
          // two never collide on (record_source, source_record_id).
          source_record_id: String(organisationNumber),
          raw_payload: payload,
          source_country: "GB",
          source_registry_name: "Charity Commission for England and Wales",
        });
      }

      return {
        records,
        truncated,
        walkedOrganisations: stats.charitiesScanned,
        // Recorded on the run itself, not only handed to `onStats` for a
        // terminal nobody is watching: the funnel is the answer to "why is
        // charity X not in the list", and it is worth keeping run to run.
        stats: { ...stats },
      };
    },

    onError(err: Error) {
      console.error("[charity_commission_bulk] import failed:", err.message);
    },
  };
}
