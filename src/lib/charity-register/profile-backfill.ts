import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { bulkSector } from "../standardize/charity-commission-bulk.ts";
import { lookupCharityProfile } from "./sqlite.ts";

/**
 * Filling in the register profile for charities that predate the bulk import.
 *
 * ── The gap this closes ──
 *
 * `organisations.charity_activities`, `sector`, `registered_on` and
 * `charity_reporting_status` are written in exactly one place:
 * `annotateOrganisation`, called from the bulk import's promote loop
 * (`write-organisations.ts`). That call sits *after* `flagIfDuplicate`, which
 * `continue`s on a charity already on the client list — so the annotate step is
 * reachable only on the insert path, for a charity arriving for the first time.
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
] as const;

type ProfileColumn = (typeof PROFILE_COLUMNS)[number];

/** One stored organisation, as far as this job is concerned. */
export type StoredProfile = {
  id: string;
  charity_activities: string | null;
  sector: string | null;
  registered_on: string | null;
  charity_reporting_status: string | null;
};

/** The write this job would make for one organisation. */
export type ProfilePatch = Partial<Record<ProfileColumn, string>>;

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

/** How many fields a patch fills. */
export function patchSize(patch: ProfilePatch): number {
  return PROFILE_COLUMNS.reduce((count, column) => count + (patch[column] ? 1 : 0), 0);
}

/** Organisation ids per `in (...)` filter — same ceiling as the Part B backfill:
 *  a single list of a thousand uuids is a ~40KB query string and PostgREST
 *  answers that with a bare 400. */
const ID_FILTER_CHUNK = 200;
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
  "id, charity_activities, sector, registered_on, charity_reporting_status";

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
): Promise<{ targets: BackfillTarget[]; coverage: ProfileCoverage }> {
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
      coverage: { charities: 0, covered: 0, pending: 0, pendingFields: 0 },
    };
  }

  const stored = new Map<string, StoredProfile>();
  const ids = charities.map((row) => row.organisation_id);
  for (let i = 0; i < ids.length; i += ID_FILTER_CHUNK) {
    const slice = ids.slice(i, i + ID_FILTER_CHUNK);
    const page = await readAll<StoredProfile>((from, to) =>
      supabase
        .from("organisations")
        .select(ORGANISATION_COLUMNS)
        .in("id", slice)
        .order("id", { ascending: true })
        .range(from, to)
        // The select string is assembled rather than a literal, and supabase-js
        // can only infer a row type from a literal — so the shape is named here.
        .returns<StoredProfile[]>(),
    );
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
