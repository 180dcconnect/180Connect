import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { bulkSector } from "../standardize/charity-commission-bulk.ts";
import {
  chunkIds,
  loadCharityIdentifiers,
  mapPool,
  type CharityIdentifierRow,
} from "./coverage-reads.ts";
import { lookupCharityProfile } from "./sqlite.ts";

/**
 * Filling in the register profile for charities that predate the bulk import.
 *
 * ── The gap this closes ──
 *
 * `organisations.charity_activities`, `sector`, `registered_on` and
 * `charity_reporting_status` are written on the bulk insert path
 * (`annotateOrganisation`, called from the bulk import's promote loop in
 * `write-organisations.ts`) and, for single-charity lookups, by that loop's
 * own register-file follow-up — the API payload carries none of these fields,
 * so the loop reads them from the register file under the same charity number
 * before and after the insert.
 *
 * Every charity imported by the retired API discovery path is therefore stuck
 * without these four fields, permanently, because re-running the import
 * recognises it as a duplicate and skips it. The API payload could not have
 * supplied them either: its shape is the register *summary* — name, address,
 * income, status — and carries no activities field at all. Oxfam is the case
 * that surfaced it. Its booklet said "official mission details and activities
 * are not provided in the primary register profile" while `data/register.sqlite`
 * held 365 characters of filed activities under the same charity number.
 *
 * This walks the client list instead of the register, the same way
 * `annual-return-backfill.ts` does for Part B of the annual return, and writes
 * only what the API road could never have written.
 *
 * ── Why it is safe to run over everything ──
 *
 * The register file is local, read-only and already in the deployment, so the
 * scan costs no network. An organisation enters the batch only when the file
 * holds a value the record is missing, so a charity the register can say nothing
 * new about is never counted as pending and never becomes a job that cannot be
 * finished.
 *
 * ── What it deliberately does not touch ──
 *
 * Any field already holding a value. A stored value was written by an import
 * from this same regulator, and a backfill quietly restating it is how two jobs
 * start fighting over one column — the rule the Part B backfill sets out at
 * length, for the same reason. It also never writes `sub_sector`, which the
 * register has no equivalent of, and never touches `ENRICHMENT_RESULTS`:
 * `charity_activities` is the regulator's own text and `mission_statement` is
 * LLM-derived, and the schema comment on the column is explicit that a reader
 * showing both must not present them as the same kind of claim.
 */

/** Organisations one press may write. Local reads and a four-column update
 *  each — the cap is about keeping one press inside the function's time
 *  ceiling, nothing more. */
export const MAX_BACKFILL = 5_000;
export const DEFAULT_BACKFILL = 500;

/** The register-profile columns, and the only ones this job ever writes. */
const PROFILE_COLUMNS = [
  "charity_activities",
  "sector",
  "registered_on",
  "charity_reporting_status",
  // The regulator's solvency flags, added in 20260928100000. They belong on
  // this job rather than a new one: they are read from the same register row,
  // filled only where the column is still null, and written in the same single
  // update — so the "Fill in all of them" button on the import screen catches
  // up the whole book on solvency without a second pass over 171,800 rows.
  "insolvent",
  "in_administration",
] as const;

type ProfileColumn = (typeof PROFILE_COLUMNS)[number];

/** One stored organisation, as far as this job is concerned. */
export type StoredProfile = {
  id: string;
  charity_activities: string | null;
  sector: string | null;
  registered_on: string | null;
  charity_reporting_status: string | null;
  /**
   * Three-valued, and the distinction is load-bearing: null is "the register
   * has never been read for this organisation", which is a gap worth filling,
   * while false is the register saying it is solvent, which is not.
   */
  insolvent: boolean | null;
  in_administration: boolean | null;
};

/** The write this job would make for one organisation. */
export type ProfilePatch = Partial<Record<ProfileColumn, string | boolean>>;

export type BackfillTarget = {
  organisationId: string;
  charityNumber: string;
  patch: ProfilePatch;
};

export type ProfileCoverage = {
  /** Charities on the client list with a registration number. */
  charities: number;
  /** Of those, how many the register file can say nothing more about. */
  covered: number;
  /** Organisations with at least one field the register can fill. */
  pending: number;
  /** Field values those organisations are missing between them. */
  pendingFields: number;
};

/**
 * What one organisation is missing, matching the register's profile against the
 * stored one.
 *
 * Only a *gap* is a patch, and a gap is `null` — not a blank string. The
 * register lookup already reads whitespace as absent, so a value reaching here
 * is one the regulator actually published.
 *
 * Pure, and exported, because the invariant worth testing is "a column already
 * holding a value never reaches the payload": PostgREST writes every key present
 * in an update payload, so a patch carrying a key it did not mean to fill is the
 * one way this job could overwrite good data.
 */
export function patchFor(
  stored: StoredProfile,
  fromRegister: {
    activities: string | null;
    dateOfRegistration: string | null;
    reportingStatus: string | null;
    classifications: readonly string[];
    insolvent: boolean | null;
    inAdministration: boolean | null;
  },
): ProfilePatch {
  const patch: ProfilePatch = {};

  if (stored.charity_activities === null && fromRegister.activities !== null) {
    patch.charity_activities = fromRegister.activities;
  }
  if (stored.registered_on === null && fromRegister.dateOfRegistration !== null) {
    patch.registered_on = fromRegister.dateOfRegistration;
  }
  if (stored.charity_reporting_status === null && fromRegister.reportingStatus !== null) {
    patch.charity_reporting_status = fromRegister.reportingStatus;
  }
  // `!== null` on both sides: `false` is the register answering "not insolvent",
  // which is worth storing, and a truthiness test here would leave every
  // solvent charity looking permanently unassessed.
  if (stored.insolvent === null && fromRegister.insolvent !== null) {
    patch.insolvent = fromRegister.insolvent;
  }
  if (stored.in_administration === null && fromRegister.inAdministration !== null) {
    patch.in_administration = fromRegister.inAdministration;
  }
  if (stored.sector === null) {
    // The same mapping the bulk import applies, off the same "What the charity
    // does" values — so a charity backfilled here lands in the taxonomy the
    // scorer reads, identically to one imported through the register screen.
    // A classification outside the accepted five maps to null, which is not a
    // gap this job can fill and so is simply left alone.
    const sector = bulkSector(fromRegister.classifications);
    if (sector !== null) patch.sector = sector;
  }

  return patch;
}

/**
 * How many fields a patch fills.
 *
 * `!== undefined`, not truthiness: a solvency flag of `false` is a real patch
 * and the entry beside it in the pending-fields count would otherwise vanish.
 */
export function patchSize(patch: ProfilePatch): number {
  return PROFILE_COLUMNS.reduce(
    (count, column) => count + (patch[column] === undefined ? 0 : 1),
    0,
  );
}

/**
 * Rows per read.
 *
 * PostgREST caps a response and does not say it truncated one, so an unpaged
 * read is a silent lie the moment the table outgrows the cap. Below the server's
 * own default so the last page is always short, which is what ends the loop.
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
  "id, charity_activities, sector, registered_on, charity_reporting_status, insolvent, in_administration";

/**
 * Every organisation the register can still say something about.
 *
 * Whole-book rather than cursored, for the same reason as the Part B job: the
 * expensive half is local SQLite and the Postgres half is a few thousand rows.
 * The caller decides how many of the returned targets to actually write.
 */
export async function findProfileTargets(
  supabase: SupabaseClient,
  /** Narrow to these organisations. The import passes the charities it just
   *  touched; the coverage card passes nothing and gets the whole book. */
  only?: ReadonlySet<string>,
  /** A scan the caller already ran. The coverage cards share one across all
   *  four finders rather than each scanning the same table. */
  sharedIdentifiers?: readonly CharityIdentifierRow[],
): Promise<{ targets: BackfillTarget[]; coverage: ProfileCoverage }> {
  const identifiers = sharedIdentifiers ?? (await loadCharityIdentifiers(supabase));

  const charities = identifiers.filter(
    (row) =>
      row.organisation_id &&
      row.identifier_value?.trim() &&
      (!only || only.has(row.organisation_id)),
  );
  if (charities.length === 0) {
    return {
      targets: [],
      coverage: { charities: 0, covered: 0, pending: 0, pendingFields: 0 },
    };
  }

  const stored = new Map<string, StoredProfile>();
  const ids = charities.map((row) => row.organisation_id);
  // Chunks run concurrently (bounded in `mapPool`): each is one small read,
  // and awaiting them one at a time multiplied the wait by the chunk count.
  const pages = await mapPool(chunkIds(ids), (slice) =>
    readAll<StoredProfile>((from, to) =>
      supabase
        .from("organisations")
        .select(ORGANISATION_COLUMNS)
        .in("id", slice)
        .order("id", { ascending: true })
        .range(from, to)
        // The select string is assembled rather than a literal, and supabase-js
        // can only infer a row type from a literal — so the shape is named here.
        .returns<StoredProfile[]>(),
    ),
  );
  for (const page of pages) {
    for (const row of page) stored.set(row.id, row);
  }

  const targets: BackfillTarget[] = [];
  let pendingFields = 0;
  for (const { organisation_id, identifier_value } of charities) {
    const held = stored.get(organisation_id);
    if (!held) continue;
    const profile = lookupCharityProfile(identifier_value);
    if (!profile) continue;

    const patch = patchFor(held, profile);
    const fills = patchSize(patch);
    if (fills === 0) continue;

    targets.push({ organisationId: organisation_id, charityNumber: identifier_value, patch });
    pendingFields += fills;
  }

  return {
    targets,
    coverage: {
      charities: charities.length,
      covered: charities.length - targets.length,
      pending: targets.length,
      pendingFields,
    },
  };
}

export type ProfileBackfillOutcome = {
  /** Organisations written on this run. */
  organisations: number;
  /** Field values written on this run. */
  fields: number;
  /** Organisations still pending after it. */
  remaining: number;
};

/**
 * Writes the next `limit` organisations' worth of register profile.
 *
 * One update per organisation rather than a batched upsert, unlike the Part B
 * job: ORGANISATIONS has no natural conflict key to upsert on, and an upsert
 * keyed on the primary key would have to carry every NOT NULL column to be a
 * legal insert — turning a four-column fill into a whole-row rewrite. An update
 * naming only the filled columns cannot touch anything else on the row, which is
 * the property that matters here.
 *
 * Sequential rather than concurrent: this competes with live traffic on the
 * table CAMs are reading, and a few hundred small updates in series is well
 * inside one press's budget. A failure stops the run and is the caller's to
 * report — a half-written backfill is resumable by construction, because a
 * filled field stops being a gap.
 */
export async function runProfileBackfill(
  supabase: SupabaseClient,
  limit: number,
): Promise<ProfileBackfillOutcome> {
  const { targets } = await findProfileTargets(supabase);
  const slice = targets.slice(0, Math.max(0, limit));

  let fields = 0;
  for (const target of slice) {
    const { error } = await supabase
      .from("organisations")
      .update(target.patch)
      .eq("id", target.organisationId);
    if (error) throw error;
    fields += patchSize(target.patch);
  }

  return {
    organisations: slice.length,
    fields,
    remaining: targets.length - slice.length,
  };
}
