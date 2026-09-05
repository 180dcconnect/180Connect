import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildFinancialPeriodsFromBulk,
  type BulkFinancialPeriodRow,
} from "../financials/charity-financial-periods.ts";
import { toExtractReturn } from "./import.ts";
import { lookupCharityReturns } from "./sqlite.ts";

/**
 * Filling in the half of the annual return the API does not publish.
 *
 * ── The gap this closes ──
 *
 * A charity's filed year can reach FINANCIAL_PERIODS by two roads, and they
 * carry different cargo:
 *
 *   - **The API** (`charity-commission-financial-refresh.ts`, nightly). Gives
 *     the totals and the SOFA breakdown. Publishes no headcount, no received
 *     date, and no government-funding flags — there is no endpoint for them.
 *   - **The bulk extract** (the register file, via an import). Gives all of
 *     that, because Part B of the annual return is in the extract.
 *
 * So every charity whose accounts arrived by the first road has five years of
 * income and a blank where the staff and volunteer counts should be. Oxfam is
 * the case that surfaced it: the Financials tab said "People — not reported"
 * while `data/register.sqlite` held 4,084 staff and 28,920 volunteers for the
 * same year end. The register import cannot fix it either, because a charity
 * already on the client list is flagged as a match rather than re-promoted.
 *
 * This walks the client list instead of the register, and writes only what the
 * API road could never have written.
 *
 * ── Why it is safe to run over everything ──
 *
 * The register file is local, read-only and already in the deployment, so the
 * scan costs no network at all — the only budget that matters is the Postgres
 * write, and an organisation is only in the batch when the file actually holds
 * a value we are missing. A charity that files an entry-level return has no
 * Part B anywhere, is never counted as pending, and so never becomes a job that
 * can't be finished. Coverage reaching 100% means 100%.
 *
 * ── What it deliberately does not touch ──
 *
 * Totals, the income band, and the SOFA breakdown, on periods we already hold.
 * Those are the API's job and it does them; rewriting them here would mean two
 * sources racing to own the same number, and a restatement between the extract
 * and the API would quietly move a client's income and its score. Filed years
 * we hold *no* row for are also left alone — adding a year is an import
 * decision, and the import screen is where it is made.
 */

/** Organisations one press may write. Local reads, seven columns each — the cap
 *  is about keeping one press inside the function's time ceiling, nothing more. */
export const MAX_BACKFILL = 5_000;
export const DEFAULT_BACKFILL = 500;

/** The Part B columns, and the only ones this job ever writes. */
const EXTRA_COLUMNS = [
  "filing_date",
  "count_employees",
  "count_volunteers",
  "receives_govt_grants",
  "receives_govt_contracts",
  "count_govt_grants",
  "count_govt_contracts",
] as const;

/** One stored period, as far as this job is concerned. */
export type StoredPeriod = {
  period_start: string | null;
  period_end: string | null;
  filing_date: string | null;
  count_employees: number | null;
  count_volunteers: number | null;
  receives_govt_grants: boolean | null;
  receives_govt_contracts: boolean | null;
  count_govt_grants: number | null;
  count_govt_contracts: number | null;
};

/** The write this job would make for one period. */
export type PeriodPatch = {
  periodStart: string;
  periodEnd: string;
  filing_date: string | null;
  count_employees: number | null;
  count_volunteers: number | null;
  receives_govt_grants: boolean | null;
  receives_govt_contracts: boolean | null;
  count_govt_grants: number | null;
  count_govt_contracts: number | null;
};

/** The register's value for one extra, off a built bulk row. */
function registerValue(
  period: BulkFinancialPeriodRow,
  column: (typeof EXTRA_COLUMNS)[number],
): string | number | boolean | null {
  switch (column) {
    case "filing_date":
      return period.filingDate;
    case "count_employees":
      return period.countEmployees;
    case "count_volunteers":
      return period.countVolunteers;
    case "receives_govt_grants":
      return period.receivesGovtGrants;
    case "receives_govt_contracts":
      return period.receivesGovtContracts;
    case "count_govt_grants":
      return period.countGovtGrants;
    case "count_govt_contracts":
      return period.countGovtContracts;
  }
}

/**
 * What one organisation is missing, matching the register's periods against
 * the stored ones.
 *
 * Only a *gap* is a patch. A stored value is never overwritten, even where the
 * extract disagrees: a figure already on the record was written by an import
 * from this same regulator, and a backfill quietly restating it is how two jobs
 * start fighting over one column. Nothing to add returns an empty list, which
 * is what keeps the coverage figure honest.
 */
export function patchesFor(
  stored: readonly StoredPeriod[],
  fromRegister: readonly BulkFinancialPeriodRow[],
): PeriodPatch[] {
  const byEnd = new Map<string, StoredPeriod>();
  for (const period of stored) {
    if (period.period_end) byEnd.set(period.period_end, period);
  }

  const patches: PeriodPatch[] = [];
  for (const period of fromRegister) {
    const held = byEnd.get(period.periodEnd);
    // A year we hold no row for is an import's business, not this job's.
    if (!held || !held.period_start) continue;

    const patch: PeriodPatch = {
      // The stored start, not the register's: it is half the upsert's conflict
      // key, and a row that disagreed by a day would be inserted rather than
      // updated — the one way this job could create a duplicate filed year.
      periodStart: held.period_start,
      periodEnd: period.periodEnd,
      filing_date: null,
      count_employees: null,
      count_volunteers: null,
      receives_govt_grants: null,
      receives_govt_contracts: null,
      count_govt_grants: null,
      count_govt_contracts: null,
    };

    let fills = 0;
    for (const column of EXTRA_COLUMNS) {
      const value = registerValue(period, column);
      if (value === null || held[column] !== null) continue;
      // Narrowed per column above; the patch's field types match the register's.
      (patch as Record<string, unknown>)[column] = value;
      fills += 1;
    }

    if (fills > 0) patches.push(patch);
  }

  return patches;
}

/** Every filed period the register holds for a charity, already built. */
export function registerPeriods(charityNumber: string): BulkFinancialPeriodRow[] {
  const found = lookupCharityReturns(charityNumber);
  if (!found) return [];
  return buildFinancialPeriodsFromBulk(found.returns.map(toExtractReturn));
}

export type BackfillTarget = {
  organisationId: string;
  charityNumber: string;
  patches: PeriodPatch[];
};

export type AnnualReturnCoverage = {
  /** Charities on the client list with a registration number. */
  charities: number;
  /** Of those, how many the register file can say nothing more about. */
  covered: number;
  /** Organisations with at least one period the register can fill. */
  pending: number;
  /** Period rows those organisations are missing between them. */
  pendingPeriods: number;
};

/** Organisation ids per `in (...)` filter — same ceiling as the API refresh:
 *  a single list of a thousand uuids is a ~40KB query string and PostgREST
 *  answers that with a bare 400. */
const ID_FILTER_CHUNK = 200;
/** Period rows per upsert. Well inside what one PostgREST request carries. */
const WRITE_CHUNK = 500;
/**
 * Rows per read.
 *
 * PostgREST caps a response and *does not say it truncated one*, so an unpaged
 * read is a silent lie the moment the table outgrows the cap. This job asks two
 * questions that both outgrow it — every charity we hold, and every period
 * behind them — and the first version of it reported "1,000 charities, 5
 * outstanding" against a book of 1,502 with 792. Below the server's own default
 * so the last page is always short, which is what ends the loop.
 */
const READ_PAGE = 900;

/** Reads every page of a query, rather than the first one the server felt like
 *  returning. `build` is called per page because a PostgREST builder is a
 *  one-shot thenable and cannot be re-ranged. */
async function readAll<Row>(
  build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await build(from, from + READ_PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < READ_PAGE) return rows;
  }
}

const PERIOD_COLUMNS =
  "organisation_id, period_start, period_end, filing_date, count_employees, " +
  "count_volunteers, receives_govt_grants, receives_govt_contracts, " +
  "count_govt_grants, count_govt_contracts";

type PeriodRow = StoredPeriod & { organisation_id: string };

/**
 * Every organisation the register can still say something about.
 *
 * Whole-book rather than cursored: the expensive half is local SQLite, the
 * Postgres half is a few thousand rows, and a cursor would buy nothing but a
 * column on the Data Model to explain. The caller decides how many of the
 * returned targets to actually write. Paged only because the *server* pages —
 * see `READ_PAGE`.
 */
export async function findBackfillTargets(
  supabase: SupabaseClient,
  /** Narrow to these organisations. The weekly refresh passes the charities it
   *  just wrote; the coverage card passes nothing and gets the whole book. */
  only?: ReadonlySet<string>,
): Promise<{ targets: BackfillTarget[]; coverage: AnnualReturnCoverage }> {
  const identifiers = await readAll<{ organisation_id: string; identifier_value: string }>(
    (from, to) =>
      supabase
        .from("organisation_identifiers")
        .select("organisation_id, identifier_value")
        .eq("identifier_type", "uk_charity")
        // Ordered so the pages tile rather than overlap: without it the server
        // is free to return rows in a different order per request, and paging
        // an unordered read drops some rows and repeats others.
        .order("organisation_id", { ascending: true })
        .range(from, to)
        .returns<{ organisation_id: string; identifier_value: string }[]>(),
  );

  const charities = (identifiers ?? []).filter(
    (row) =>
      row.organisation_id &&
      row.identifier_value?.trim() &&
      (!only || only.has(row.organisation_id)),
  );
  if (charities.length === 0) {
    return {
      targets: [],
      coverage: { charities: 0, covered: 0, pending: 0, pendingPeriods: 0 },
    };
  }

  const stored = new Map<string, StoredPeriod[]>();
  const ids = charities.map((row) => row.organisation_id);
  for (let i = 0; i < ids.length; i += ID_FILTER_CHUNK) {
    const slice = ids.slice(i, i + ID_FILTER_CHUNK);
    const page = await readAll<PeriodRow>((from, to) =>
      supabase
        .from("financial_periods")
        .select(PERIOD_COLUMNS)
        .eq("financial_source", "charity_commission")
        .in("organisation_id", slice)
        .order("organisation_id", { ascending: true })
        .order("period_end", { ascending: true })
        .range(from, to)
        // The select string is assembled rather than a literal, and supabase-js
        // can only infer a row type from a literal — so the shape is named here.
        .returns<PeriodRow[]>(),
    );
    for (const row of page) {
      const list = stored.get(row.organisation_id);
      if (list) list.push(row);
      else stored.set(row.organisation_id, [row]);
    }
  }

  const targets: BackfillTarget[] = [];
  let pendingPeriods = 0;
  for (const { organisation_id, identifier_value } of charities) {
    const held = stored.get(organisation_id);
    if (!held || held.length === 0) continue;
    const patches = patchesFor(held, registerPeriods(identifier_value));
    if (patches.length === 0) continue;
    targets.push({ organisationId: organisation_id, charityNumber: identifier_value, patches });
    pendingPeriods += patches.length;
  }

  return {
    targets,
    coverage: {
      charities: charities.length,
      covered: charities.length - targets.length,
      pending: targets.length,
      pendingPeriods,
    },
  };
}

export type BackfillOutcome = {
  /** Organisations written on this run. */
  organisations: number;
  /** Period rows written on this run. */
  periods: number;
  /** Organisations still pending after it. */
  remaining: number;
};

/** One upsert payload: the conflict key, plus only the columns being filled. */
export type WriteBatch = {
  /** The Part B columns this batch sets, for tests and for the comment above it. */
  columns: string[];
  rows: Record<string, unknown>[];
};

/**
 * The upsert payloads for a set of targets, grouped by which columns they fill.
 *
 * **This grouping is the whole point, and the first version not having it
 * destroyed data.** PostgREST's upsert resolves a conflict with
 * `ON CONFLICT ... DO UPDATE SET`, and the SET list is *every column present in
 * the payload*. A column absent from the payload is left alone; a column present
 * and null is written as null. The first version built one uniform row shape
 * carrying all seven columns, with null meaning "no gap here" — so filling a
 * charity's government-funding flag also wrote null over the staff count and the
 * filing date sitting beside it. On staging that wiped 816 headcounts and 2,205
 * filing dates in a single press.
 *
 * So a row carries a column only when that column is actually being filled, and
 * rows are grouped by their column set because one upsert request needs one row
 * shape. In practice that is a handful of groups, not the 127 the arithmetic
 * allows: charities are missing Part B in a few recurring patterns, not
 * arbitrary ones.
 *
 * Pure, and exported, because the invariant worth testing is "an unfilled column
 * never reaches the payload" — and the tests that only checked the patch object
 * passed happily while the write did the opposite.
 */
export function writeBatchesFor(targets: readonly BackfillTarget[]): WriteBatch[] {
  const groups = new Map<string, WriteBatch>();

  for (const target of targets) {
    for (const patch of target.patches) {
      const columns = EXTRA_COLUMNS.filter((column) => patch[column] !== null);
      // patchesFor never emits a patch with nothing in it, but a batch of one
      // bare conflict key would be an upsert that means nothing.
      if (columns.length === 0) continue;

      const key = columns.join(",");
      const batch = groups.get(key) ?? { columns: [...columns], rows: [] };
      const row: Record<string, unknown> = {
        organisation_id: target.organisationId,
        period_start: patch.periodStart,
        period_end: patch.periodEnd,
        financial_source: "charity_commission",
      };
      for (const column of columns) row[column] = patch[column];
      batch.rows.push(row);
      groups.set(key, batch);
    }
  }

  return [...groups.values()];
}

/**
 * Writes the next `limit` organisations' worth of Part B.
 *
 * Each upsert names the conflict key and only the columns that batch fills, so
 * on the row it finds — which is every row here, because a patch only exists for
 * a period we already hold — it updates exactly those and leaves everything
 * else, the totals and the breakdown included, as it found them.
 */
export async function runAnnualReturnBackfill(
  supabase: SupabaseClient,
  limit: number,
): Promise<BackfillOutcome> {
  const { targets } = await findBackfillTargets(supabase);
  const slice = targets.slice(0, Math.max(0, limit));

  const batches = writeBatchesFor(slice);

  let periods = 0;
  for (const batch of batches) {
    for (let i = 0; i < batch.rows.length; i += WRITE_CHUNK) {
      const { error } = await supabase
        .from("financial_periods")
        .upsert(batch.rows.slice(i, i + WRITE_CHUNK), {
          onConflict: "organisation_id,period_start,period_end,financial_source",
        });
      if (error) throw error;
    }
    periods += batch.rows.length;
  }

  return {
    organisations: slice.length,
    periods,
    remaining: targets.length - slice.length,
  };
}

/**
 * Fills Part B for organisations that have just been written by the API path.
 *
 * Called at the end of the weekly financial refresh, which is what stops this
 * gap reopening on its own. The refresh creates a period row the moment a
 * charity files a new year, and it creates it from an endpoint that publishes no
 * headcount — so without this, every new filing arrives blank and stays blank
 * until somebody notices and presses a button.
 *
 * It cannot close the gap completely and is not meant to: the register file is
 * rebuilt monthly, so a year filed since the last rebuild has no Part B
 * anywhere yet. That year fills itself on the first refresh after the next
 * rebuild. The button on the imports page stays as the way to see what is
 * outstanding and to catch up without waiting a week.
 *
 * Failures are the caller's to swallow. This runs after the refresh has already
 * written what it came to write, and a missing register file must not turn a
 * successful refresh into a failed one.
 */
export async function fillPartBFor(
  supabase: SupabaseClient,
  organisationIds: ReadonlySet<string>,
): Promise<{ organisations: number; periods: number }> {
  if (organisationIds.size === 0) return { organisations: 0, periods: 0 };

  const { targets } = await findBackfillTargets(supabase, organisationIds);
  const batches = writeBatchesFor(targets);

  let periods = 0;
  for (const batch of batches) {
    for (let i = 0; i < batch.rows.length; i += WRITE_CHUNK) {
      const { error } = await supabase
        .from("financial_periods")
        .upsert(batch.rows.slice(i, i + WRITE_CHUNK), {
          onConflict: "organisation_id,period_start,period_end,financial_source",
        });
      if (error) throw error;
    }
    periods += batch.rows.length;
  }

  return { organisations: targets.length, periods };
}
