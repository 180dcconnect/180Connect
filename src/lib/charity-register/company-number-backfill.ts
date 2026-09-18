import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { charityByRegisteredNumber } from "./sqlite.ts";
import { companyNumberForRegisteredCharity, type CharityCompanyLookup } from "./company-identifier.ts";
import {
  chunkIds,
  loadCharityIdentifiers,
  mapPool,
  type CharityIdentifierRow,
} from "./coverage-reads.ts";

/**
 * Filling in the second registration number for charity clients that predate it.
 *
 * ── The gap this closes ──
 *
 * A charity that is also a company carries two numbers, and the register
 * publishes both. Since 20261005120000 a client created from a manual entry
 * carries both: the number the CAM typed as `uk_charity`, and the register's
 * company number as `uk_company`. Every charity that got onto the client list
 * before that holds only the first — so the record cannot answer "is this also a
 * company", and the grant lookup can only ask 360Giving about one of the two
 * numbers. Re-importing does not help: an organisation already held is treated
 * as a duplicate and skipped, which is the same reason the profile, reach and
 * Part B backfills beside this one exist.
 *
 * ── What it reads, and what it leaves alone ──
 *
 * The register file, by the charity number already on the record — `uk_charity`
 * identifiers only, and only where the value has the shape that register issues
 * (six or seven digits). No other type is guessed at: a six-digit value on a
 * `manual` row might be a charity number or some other regulator's, and the
 * value alone cannot say which. `company-identifier.ts` owns the read and the
 * normalisation, so the number this writes is the same one the add-a-client form
 * shows and the same one an approval files.
 *
 * A client that already holds a company number is never touched: that number is
 * either the register's own or someone's correction, and a backfill restating it
 * is how two writers start fighting over one column. Nor is a number ever
 * removed or changed — this job only adds.
 *
 * ── Not the whole story ──
 *
 * `is_primary` stays with the charity number: the company number is
 * corroboration, not the identity this record was matched and deduplicated on.
 * And `verified` is left false, because nothing has confirmed the number against
 * the register — it was read out of the register, which is "held", not "checked".
 */

/** Organisations one press may write. One local file read and one inserted row
 *  each — the cap keeps a single press inside the function's time ceiling, the
 *  same figure the backfills beside it use. */
export const MAX_BACKFILL = 5_000;
export const DEFAULT_BACKFILL = 500;

/** The register whose file answers this question. The identifier is `uk_charity`,
 *  which only ever comes from the England and Wales register — the one register
 *  we hold a file for. */
const CHARITY_REGISTER = "ccew" as const;

const COMPANY_REGISTRY_NAME = "Companies House";

export type CompanyNumberTarget = {
  organisationId: string;
  /** The charity number already on the record, as read. */
  charityNumber: string;
  /** The register's company number for it, normalised. */
  companyNumber: string;
};

export type CompanyNumberCoverage = {
  /** Charities on the client list with a registration number. */
  charities: number;
  /** Of those, how many need nothing: a company number is already held, or the
   *  register publishes none for this charity. */
  covered: number;
  /** Charities whose second number the register file can supply. */
  pending: number;
};

/**
 * The organisations still to write, from the numbers already on the client list.
 *
 * Pure, and exported, because the invariants worth testing are the two ways this
 * job could damage a record — turning a *company* number into a charity lookup,
 * and restating a number somebody already holds. Neither needs a database to
 * demonstrate, and both are invisible if only the happy path is covered.
 */
export function companyNumberTargetsFor(input: {
  /** `uk_charity` identifiers: organisation id and the charity number. */
  charityNumbers: readonly { organisation_id: string; identifier_value: string }[];
  /** Organisations that already carry a `uk_company` identifier. */
  holders: ReadonlySet<string>;
  lookup?: CharityCompanyLookup;
  /** Narrow to these organisations. The coverage card passes nothing. */
  only?: ReadonlySet<string>;
}): CompanyNumberTarget[] {
  const { charityNumbers, holders, lookup = charityByRegisteredNumber, only } = input;

  // One row per organisation, first wins: two charity identifiers on one client
  // (a re-registration, a legacy row) describe one organisation, and writing two
  // company numbers from them would file the same fact twice.
  const seen = new Set<string>();
  const targets: CompanyNumberTarget[] = [];

  for (const row of charityNumbers) {
    const organisationId = row.organisation_id;
    if (!organisationId || seen.has(organisationId)) continue;
    seen.add(organisationId);
    if (only && !only.has(organisationId)) continue;

    // Already holds a company number. Someone's answer, kept.
    if (holders.has(organisationId)) continue;

    const companyNumber = companyNumberForRegisteredCharity(CHARITY_REGISTER, row.identifier_value, lookup);
    if (!companyNumber) continue;

    targets.push({
      organisationId,
      charityNumber: row.identifier_value.trim(),
      companyNumber,
    });
  }

  return targets;
}

/**
 * The rows one run inserts. Pure, and exported, because the payload's shape is
 * the other thing that must not drift: an identifier with the wrong type or a
 * `is_primary` set would either hide the number from every register-aware
 * feature or break the one-primary-per-organisation rule.
 */
export function companyIdentifierRowsFor(
  targets: readonly CompanyNumberTarget[],
): Record<string, unknown>[] {
  return targets.map((target) => ({
    organisation_id: target.organisationId,
    identifier_type: "uk_company",
    identifier_value: target.companyNumber,
    registry_name: COMPANY_REGISTRY_NAME,
    // Companies House is a UK register and the charity number it was derived from
    // is an England and Wales one, so the country is not in question here.
    registry_country: "GB",
    // The organisation already has its primary identifier — the number it was
    // created and deduplicated by. This one corroborates it.
    is_primary: false,
    // Read out of the register, not confirmed against it. Same distinction the
    // record's docket draws.
    verified: false,
  }));
}

/** Organisation ids per `in (...)` filter — the ceiling the backfills beside
 *  this one use: a single list of a thousand uuids is a ~40KB query string and
 *  PostgREST answers that with a bare 400. */
const ID_FILTER_CHUNK = 200;
/** Period rows per insert. Well inside what one PostgREST request carries. */
const WRITE_CHUNK = 500;
/** Rows per read. PostgREST caps a response and does not say it truncated one,
 *  so an unpaged read is a silent lie the moment the table outgrows the cap.
 *  Below the server's own default so the last page is always short. */
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

/**
 * Which of these organisations already hold a company number.
 *
 * Scoped to the organisations in hand rather than reading the whole table: the
 * client list is what this job walks, and a company number on an organisation
 * outside it is not this job's business.
 */
export async function companyNumberHolderIds(
  supabase: SupabaseClient,
  organisationIds: readonly string[],
): Promise<Set<string>> {
  const holders = new Set<string>();

  // The chunks are independent. Keep the database-friendly cap from the other
  // finders instead of turning a long list into a serial chain of round trips.
  const pages = await mapPool(chunkIds(organisationIds, ID_FILTER_CHUNK), (slice) =>
    readAll<{ organisation_id: string }>((from, to) =>
      supabase
        .from("organisation_identifiers")
        .select("organisation_id")
        .eq("identifier_type", "uk_company")
        .in("organisation_id", slice)
        // Ordered so the pages tile rather than overlap: without it the server
        // is free to return rows in a different order per request, and paging an
        // unordered read drops some rows and repeats others.
        .order("organisation_id", { ascending: true })
        .range(from, to)
        .returns<{ organisation_id: string }[]>(),
    ),
  );
  for (const rows of pages) {
    for (const row of rows) holders.add(row.organisation_id);
  }

  return holders;
}

/**
 * Every charity whose second number the register file can still supply.
 *
 * Whole-book rather than cursored, like the jobs beside it: the register is a
 * file in the deployment, so the expensive half is local reads and the Postgres
 * half is a few thousand identifier rows. The caller decides how many of the
 * returned targets to actually write.
 */
export async function findCompanyNumberTargets(
  supabase: SupabaseClient,
  /** Narrow to these organisations. */
  only?: ReadonlySet<string>,
  lookup?: CharityCompanyLookup,
  /** A scan the caller already ran. The coverage cards share one across all
   *  four finders rather than each scanning the same table. */
  sharedIdentifiers?: readonly CharityIdentifierRow[],
): Promise<{ targets: CompanyNumberTarget[]; coverage: CompanyNumberCoverage }> {
  const identifiers = sharedIdentifiers ?? (await loadCharityIdentifiers(supabase));

  const charityNumbers = identifiers.filter(
    (row) => row.organisation_id && row.identifier_value?.trim(),
  );
  if (charityNumbers.length === 0) {
    return { targets: [], coverage: { charities: 0, covered: 0, pending: 0 } };
  }

  const holders = await companyNumberHolderIds(
    supabase,
    charityNumbers.map((row) => row.organisation_id),
  );

  const targets = companyNumberTargetsFor({ charityNumbers, holders, lookup, only });

  // Charities, not identifier rows: every count on the card is about
  // organisations, so a duplicated identifier cannot inflate it.
  const organisations = new Set(charityNumbers.map((row) => row.organisation_id)).size;

  return {
    targets,
    coverage: {
      charities: organisations,
      covered: organisations - targets.length,
      pending: targets.length,
    },
  };
}

export type CompanyNumberBackfillOutcome = {
  /** Organisations written on this run. */
  organisations: number;
  /** Identifier rows inserted on this run. */
  numbers: number;
  /** Organisations still pending after it. */
  remaining: number;
  /** Targets another run had already written when this one re-read them. */
  skipped: number;
};

/**
 * Writes the next `limit` charities' company numbers.
 *
 * The holders are read again immediately before the insert. The target list was
 * built at the start of the run, and two people pressing this at once — or one
 * person pressing it in two tabs — would otherwise both decide an organisation
 * holds no company number and both insert one. Nothing downstream deduplicates
 * `organisation_identifiers`, so that would leave the same number twice on one
 * client for good.
 *
 * Sequential, one insert per chunk, and a failure stops the run: a half-written
 * backfill is resumable by construction, because a written number stops being a
 * gap.
 */
export async function runCompanyNumberBackfill(
  supabase: SupabaseClient,
  limit: number,
  lookup?: CharityCompanyLookup,
): Promise<CompanyNumberBackfillOutcome> {
  const { targets } = await findCompanyNumberTargets(supabase, undefined, lookup);
  const slice = targets.slice(0, Math.max(0, limit));
  if (slice.length === 0) {
    return { organisations: 0, numbers: 0, remaining: 0, skipped: 0 };
  }

  const alreadyHolding = await companyNumberHolderIds(
    supabase,
    slice.map((target) => target.organisationId),
  );
  const fresh = slice.filter((target) => !alreadyHolding.has(target.organisationId));

  const rows = companyIdentifierRowsFor(fresh);
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const { error } = await supabase
      .from("organisation_identifiers")
      .insert(rows.slice(i, i + WRITE_CHUNK));
    if (error) throw error;
  }

  return {
    organisations: fresh.length,
    numbers: rows.length,
    remaining: targets.length - slice.length,
    skipped: slice.length - fresh.length,
  };
}
