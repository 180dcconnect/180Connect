import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveGeographicReach } from "../standardize/geographic-reach.ts";
import { computeCompletenessScore, type GeographicReach } from "../standardize/types.ts";
import {
  chunkIds,
  loadCharityIdentifiers,
  mapPool,
  type CharityIdentifierRow,
} from "./coverage-reads.ts";
import { lookupCharityOperatingAreas } from "./sqlite.ts";

/**
 * Filling in geographic reach for charities that predate the derive.
 *
 * ── The gap this closes ──
 *
 * `organisations.geographic_reach` has exactly one automatic writer:
 * `applyDerivedReach` in `standardize/write-organisations.ts`, called from the
 * two charity promote loops. It runs *after* the duplicate check, so it only
 * ever touches rows about to be inserted — which is the right rule for an
 * import (it can never restate a value a human corrected) and the reason every
 * charity already on the client list when the derive landed is stuck with the
 * column empty, permanently: re-importing recognises them as duplicates and
 * skips them.
 *
 * The register file is the only source for this field. No API payload carries
 * areas of operation, and every other standardizer writes null on purpose
 * rather than guessing, so the whole client list reads as "reach unknown" —
 * the field the outreach prompt and the CAM queue preferences both read.
 *
 * This walks the client list instead of the register, exactly as
 * `profile-backfill.ts` does for activities and sector, and writes the one
 * field the insert path could have written but never gets a second chance at.
 *
 * ── What it derives from ──
 *
 * `deriveGeographicReach` over the charity's FULL declared operating areas —
 * the annual return's local authorities, regions and countries. Never the
 * import filter's matched areas: those hold only the priority authorities a
 * filter selected on, and reading them would call a national charity local.
 * The ladder is conservative by design and answers null when the charity
 * declared nothing, which is not a gap this job can fill.
 *
 * ── What it deliberately does not touch ──
 *
 * Any row whose reach is already set, by an import or by an admin editing the
 * field on the client record. A stored value is someone's answer; a backfill
 * restating it is how two writers start fighting over one column.
 *
 * It does rewrite `data_completeness_score`, because that score counts
 * `geographic_reach` among its eight scoreable fields — the same recompute
 * `applyDerivedReach` does on the insert path, for the same reason: the stored
 * score must match the stored row.
 */

/** Organisations one press may write. A local file read and a two-column
 *  update each — the cap is about keeping one press inside the function's
 *  time ceiling, nothing more. Same figures as the profile backfill. */
export const MAX_BACKFILL = 5_000;
export const DEFAULT_BACKFILL = 500;

/**
 * One stored organisation, as far as this job is concerned: the field being
 * filled, plus the seven other fields the completeness score counts, so the
 * score can be recomputed without a second read.
 */
export type StoredReach = {
  id: string;
  geographic_reach: GeographicReach | null;
  legal_name: string | null;
  trading_name: string | null;
  website: string | null;
  contact_email: string | null;
  address_line_1: string | null;
  city: string | null;
  postcode: string | null;
  data_completeness_score: number | null;
};

/** The write this job would make for one organisation. */
export type ReachPatch = {
  geographic_reach: GeographicReach;
  data_completeness_score: number;
};

export type ReachTarget = {
  organisationId: string;
  charityNumber: string;
  patch: ReachPatch;
};

export type ReachCoverage = {
  /** Charities on the client list with a registration number. */
  charities: number;
  /** Of those, how many need nothing: reach already set, or the register
   *  declares no areas to read one from. */
  covered: number;
  /** Charities whose reach the register file can fill in. */
  pending: number;
};

/**
 * The completeness score for a row, once reach is filled in.
 *
 * Delegates to `computeCompletenessScore` rather than restating its arithmetic:
 * one definition of the score, wherever it is written. Only the eight scoreable
 * fields reach the calculation, so the rest of the shape is filled with
 * placeholders that cannot affect the result — the alternative is reading a
 * dozen more columns per organisation to feed values the function ignores.
 *
 * Null columns become "" because the stored row and the standardizer disagree
 * on how an empty field looks; the score counts both as unfilled either way.
 */
function scoreWithReach(stored: StoredReach, reach: GeographicReach): number {
  return computeCompletenessScore({
    legal_name: stored.legal_name ?? "",
    trading_name: stored.trading_name ?? "",
    website: stored.website ?? "",
    contact_email: stored.contact_email ?? "",
    address_line_1: stored.address_line_1 ?? "",
    city: stored.city ?? "",
    postcode: stored.postcode ?? "",
    geographic_reach: reach,
    // Ignored by the score. Placeholders, not claims about the record.
    country_code: "",
    is_international: false,
    entry_method: "api",
    is_verified: false,
    organisation_type: "charity",
    outreach_status: "not_contacted",
    owner_id: null,
    is_seed: false,
  });
}

/**
 * The write for one organisation, or null when there is nothing to do.
 *
 * Pure, and exported, because the invariant worth testing is "a row that
 * already has a reach never produces a patch": PostgREST writes every key
 * present in an update payload, so a patch built when it should not have been
 * is the one way this job could overwrite an admin's correction.
 */
export function reachPatchFor(
  stored: StoredReach,
  areas: Parameters<typeof deriveGeographicReach>[0],
): ReachPatch | null {
  if (stored.geographic_reach !== null) return null;

  const reach = deriveGeographicReach(areas);
  if (!reach) return null;

  return { geographic_reach: reach, data_completeness_score: scoreWithReach(stored, reach) };
}

/**
 * Rows per read. PostgREST caps a response and does not say it truncated one,
 * so an unpaged read is a silent lie the moment the table outgrows the cap.
 * Below the server's own default so the last page is always short, which is
 * what ends the loop.
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

const ORGANISATION_COLUMNS =
  "id, geographic_reach, legal_name, trading_name, website, contact_email, " +
  "address_line_1, city, postcode, data_completeness_score";

/**
 * Every charity whose reach the register file can still fill in.
 *
 * Whole-book rather than cursored, like the jobs beside it: the expensive half
 * is local SQLite and the Postgres half is a few thousand rows. The caller
 * decides how many of the returned targets to actually write.
 */
export async function findReachTargets(
  supabase: SupabaseClient,
  /** Narrow to these organisations. The coverage card passes nothing and gets
   *  the whole book. */
  only?: ReadonlySet<string>,
  /** A scan the caller already ran. The coverage cards share one across all
   *  four finders rather than each scanning the same table. */
  sharedIdentifiers?: readonly CharityIdentifierRow[],
): Promise<{ targets: ReachTarget[]; coverage: ReachCoverage }> {
  const identifiers = sharedIdentifiers ?? (await loadCharityIdentifiers(supabase));

  const charities = identifiers.filter(
    (row) =>
      row.organisation_id &&
      row.identifier_value?.trim() &&
      (!only || only.has(row.organisation_id)),
  );
  if (charities.length === 0) {
    return { targets: [], coverage: { charities: 0, covered: 0, pending: 0 } };
  }

  const stored = new Map<string, StoredReach>();
  const ids = charities.map((row) => row.organisation_id);
  // Chunks run concurrently (bounded in `mapPool`): each is one small read,
  // and awaiting them one at a time multiplied the wait by the chunk count.
  const pages = await mapPool(chunkIds(ids), (slice) =>
    readAll<StoredReach>((from, to) =>
      supabase
        .from("organisations")
        .select(ORGANISATION_COLUMNS)
        .in("id", slice)
        .order("id", { ascending: true })
        .range(from, to)
        // The select string is assembled rather than a literal, and supabase-js
        // can only infer a row type from a literal — so the shape is named here.
        .returns<StoredReach[]>(),
    ),
  );
  for (const page of pages) {
    for (const row of page) stored.set(row.id, row);
  }

  const targets: ReachTarget[] = [];
  for (const { organisation_id, identifier_value } of charities) {
    const held = stored.get(organisation_id);
    if (!held) continue;

    const patch = reachPatchFor(held, lookupCharityOperatingAreas(identifier_value));
    if (!patch) continue;

    targets.push({ organisationId: organisation_id, charityNumber: identifier_value, patch });
  }

  return {
    targets,
    coverage: {
      charities: charities.length,
      covered: charities.length - targets.length,
      pending: targets.length,
    },
  };
}

export type ReachBackfillOutcome = {
  /** Organisations written on this run. */
  organisations: number;
  /** Organisations still pending after it. */
  remaining: number;
};

/**
 * Writes the next `limit` charities' worth of reach.
 *
 * One update per organisation naming only the two columns it fills, for the
 * reason the profile backfill gives at length: ORGANISATIONS has no natural
 * conflict key, and an upsert keyed on the primary key would have to carry
 * every NOT NULL column to be a legal insert — turning a two-column fill into
 * a whole-row rewrite.
 *
 * Sequential rather than concurrent: this competes with live traffic on the
 * table CAMs are reading. A failure stops the run and is the caller's to
 * report — a half-written backfill is resumable by construction, because a
 * filled field stops being a gap.
 */
export async function runReachBackfill(
  supabase: SupabaseClient,
  limit: number,
): Promise<ReachBackfillOutcome> {
  const { targets } = await findReachTargets(supabase);
  const slice = targets.slice(0, Math.max(0, limit));

  for (const target of slice) {
    const { error } = await supabase
      .from("organisations")
      .update(target.patch)
      .eq("id", target.organisationId);
    if (error) throw error;
  }

  return { organisations: slice.length, remaining: targets.length - slice.length };
}
