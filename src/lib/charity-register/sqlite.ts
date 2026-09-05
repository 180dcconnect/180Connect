import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";

interface DatabaseSyncStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

interface DatabaseSyncInstance {
  prepare(sql: string): DatabaseSyncStatement;
  close(): void;
  exec?(sql: string): void;
}

type DatabaseSync = DatabaseSyncInstance;

function getDatabaseSync(): (new (path: string, options?: { readOnly?: boolean }) => DatabaseSync) | null {
  if (
    typeof process !== "undefined" &&
    "getBuiltinModule" in process &&
    typeof (process as { getBuiltinModule?: unknown }).getBuiltinModule === "function"
  ) {
    const mod = (
      process as {
        getBuiltinModule: (name: string) => {
          DatabaseSync?: new (path: string, options?: { readOnly?: boolean }) => DatabaseSync;
        };
      }
    ).getBuiltinModule("node:sqlite");
    if (mod?.DatabaseSync) return mod.DatabaseSync;
  }
  return null;
}

import { SCHEMA_VERSION } from "./sqlite-schema.ts";
import {
  countQuery,
  LABEL_KIND,
  labelValuesQuery,
  previewQuery,
  selectionQuery,
} from "./sqlite-query.ts";
import type { CharityRegisterFilters } from "./filters.ts";

/**
 * Opens the register file and answers questions about it.
 *
 * The file is built in CI and ships inside the deployment, so it is read-only,
 * local, and guaranteed to be the one this build was tested against. Nothing
 * here writes, and nothing here talks to Supabase — the register and the client
 * list are deliberately separate things.
 *
 * `server-only`: this must never be pulled into a browser bundle. It reads the
 * filesystem, and the file carries contact details for 171,800 organisations.
 */

/**
 * Where the file is looked for, in order.
 *
 * `REGISTER_DB_PATH` first so a deployment can point somewhere else without a
 * code change — that is the seam the `/tmp` fallback would use if a platform
 * ever refuses a file this size inside the bundle.
 */
function candidatePaths(): string[] {
  const configured = process.env.REGISTER_DB_PATH?.trim();
  return [
    ...(configured ? [configured] : []),
    join(process.cwd(), "data", "register.sqlite"),
    "/tmp/register.sqlite",
  ];
}

export type RegisterMeta = {
  builtOn: string | null;
  charities: number;
  returns: number;
  path: string;
};

/**
 * One connection per process, opened on first use.
 *
 * SQLite reads are synchronous and the file is read-only, so there is no pool
 * and no contention to manage: concurrent requests in the same function
 * instance share one handle safely. Re-opening per request would re-read the
 * header and re-warm the page cache for no benefit.
 */
let cached: { db: DatabaseSync; path: string } | null = null;
let missingReason: string | null = null;

function open(): { db: DatabaseSync; path: string } | null {
  if (cached) return cached;
  if (missingReason) return null;

  const DatabaseSyncClass = getDatabaseSync();
  if (!DatabaseSyncClass) {
    missingReason = "node:sqlite is unavailable in this environment";
    return null;
  }

  const path = candidatePaths().find((candidate) => existsSync(candidate));
  if (!path) {
    missingReason = `No register file found. Looked in: ${candidatePaths().join(", ")}`;
    return null;
  }

  const db = new DatabaseSyncClass(path, { readOnly: true });

  // A file built by an older commit would answer queries with the wrong shape
  // rather than failing, so the version is checked once, on open.
  const version = db
    .prepare("select value from meta where key = 'schema_version'")
    .get() as { value?: string } | undefined;
  if (version?.value !== SCHEMA_VERSION) {
    db.close();
    missingReason =
      `Register file at ${path} is schema version ${version?.value ?? "unknown"}, ` +
      `but this build expects ${SCHEMA_VERSION}. Refresh the register.`;
    return null;
  }

  cached = { db, path };
  return cached;
}

/** Why the register is unavailable, or null when it is fine. */
export function registerUnavailableReason(): string | null {
  open();
  return cached ? null : missingReason;
}

/** What the file is and when it was built, or null when there is no file. */
export function registerMeta(): RegisterMeta | null {
  const handle = open();
  if (!handle) return null;
  const rows = handle.db.prepare("select key, value from meta").all() as {
    key: string;
    value: string;
  }[];
  const meta = new Map(rows.map((row) => [row.key, row.value]));
  return {
    builtOn: meta.get("built_on") ?? null,
    charities: Number(meta.get("charities") ?? 0),
    returns: Number(meta.get("returns") ?? 0),
    path: handle.path,
  };
}

export type RegisterCharity = {
  organisation_number: number;
  registered_charity_number: number | null;
  charity_name: string;
  charity_type: string | null;
  reporting_status: string | null;
  date_of_registration: string | null;
  latest_income: number | null;
  latest_expenditure: number | null;
  latest_period_start: string | null;
  latest_period_end: string | null;
  postcode: string | null;
  postcode_area: string | null;
  address_lines: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_website: string | null;
  company_number: string | null;
  is_cio: number | null;
  insolvent: number | null;
  in_administration: number | null;
  activities: string | null;
};

export type RegisterPreviewRow = Pick<
  RegisterCharity,
  | "organisation_number"
  | "registered_charity_number"
  | "charity_name"
  | "latest_income"
  | "postcode"
  | "date_of_registration"
  | "activities"
  | "contact_website"
>;

/** How many charities the filters select. Fast enough to run on every change. */
export function countCharities(filters: CharityRegisterFilters): number {
  const handle = open();
  if (!handle) return 0;
  const { sql, params } = countQuery(filters);
  const row = handle.db.prepare(sql).get(...params) as { total?: number } | undefined;
  return Number(row?.total ?? 0);
}

export function previewCharities(
  filters: CharityRegisterFilters,
  limit = 25,
): RegisterPreviewRow[] {
  const handle = open();
  if (!handle) return [];
  const { sql, params } = previewQuery(filters, limit);
  return handle.db.prepare(sql).all(...params) as RegisterPreviewRow[];
}

/** Every charity the filters select, with its filed returns attached. */
export function selectCharities(
  filters: CharityRegisterFilters,
  limit?: number,
): { charity: RegisterCharity; returns: Record<string, unknown>[] }[] {
  const handle = open();
  if (!handle) return [];

  const { sql, params } = selectionQuery(filters, limit);
  const charities = handle.db.prepare(sql).all(...params) as RegisterCharity[];
  if (charities.length === 0) return [];

  // One statement, reused per charity, rather than a single query with a huge
  // `in (...)` list: SQLite caps bound parameters, an import can select
  // thousands of charities, and a prepared statement makes the per-row cost
  // negligible anyway.
  const returnsFor = handle.db.prepare(
    "select * from charity_return where organisation_number = ? order by period_end",
  );
  return charities.map((charity) => ({
    charity,
    returns: returnsFor.all(charity.organisation_number) as Record<string, unknown>[],
  }));
}

/** Every value the file holds for one label kind — the location pickers use it. */
export function labelValues(kind: string): string[] {
  const handle = open();
  if (!handle) return [];
  const { sql, params } = labelValuesQuery(kind);
  const rows = handle.db.prepare(sql).all(...params) as { value: string }[];
  return rows.map((row) => row.value);
}

/**
 * The label values of one kind that a single charity carries.
 *
 * Used by the import to record what the register says about each charity. A
 * prepared statement is cached per process, so calling this once per charity
 * across a few thousand of them stays cheap.
 */
export function charityLabels(organisationNumber: number, kind: string): string[] {
  const handle = open();
  if (!handle) return [];
  const rows = handle.db
    .prepare(
      "select l.value from charity_label cl join label l on l.id = cl.label_id " +
        "where cl.organisation_number = ? and l.kind = ? order by l.value",
    )
    .all(organisationNumber, kind) as { value: string }[];
  return rows.map((row) => row.value);
}

export type CharityOperatingAreas = {
  organisationNumber: number;
  registeredCharityNumber: number | null;
  charityName: string;
  localAuthorities: string[];
  regions: string[];
  countries: string[];
};

/**
 * Returns all declared operational areas (local authorities, regions, countries)
 * for a charity by registration number, organisation number, or name.
 */
export function lookupCharityOperatingAreas(
  identifierOrName: string | number,
): CharityOperatingAreas | null {
  const handle = open();
  if (!handle) return null;

  let row:
    | {
        organisation_number: number;
        registered_charity_number: number | null;
        charity_name: string;
      }
    | undefined;

  const numeric =
    typeof identifierOrName === "number"
      ? identifierOrName
      : Number(String(identifierOrName).replace(/\D/g, ""));

  if (numeric && Number.isFinite(numeric)) {
    row = handle.db
      .prepare(
        "select organisation_number, registered_charity_number, charity_name " +
          "from charity where registered_charity_number = ? or organisation_number = ? limit 1",
      )
      .get(numeric, numeric) as typeof row;
  }

  if (!row && typeof identifierOrName === "string" && identifierOrName.trim()) {
    row = handle.db
      .prepare(
        "select organisation_number, registered_charity_number, charity_name " +
          "from charity where charity_name = ? collate nocase limit 1",
      )
      .get(identifierOrName.trim()) as typeof row;
  }

  if (!row) return null;

  const labels = handle.db
    .prepare(
      "select l.kind, l.value from charity_label cl join label l on l.id = cl.label_id " +
        "where cl.organisation_number = ? and l.kind in ('Local Authority', 'Region', 'Country') " +
        "order by l.kind, l.value",
    )
    .all(row.organisation_number) as { kind: string; value: string }[];

  const localAuthorities: string[] = [];
  const regions: string[] = [];
  const countries: string[] = [];

  for (const label of labels) {
    if (label.kind === "Local Authority") localAuthorities.push(label.value);
    else if (label.kind === "Region") regions.push(label.value);
    else if (label.kind === "Country") countries.push(label.value);
  }

  return {
    organisationNumber: row.organisation_number,
    registeredCharityNumber: row.registered_charity_number,
    charityName: row.charity_name,
    localAuthorities,
    regions,
    countries,
  };
}


/**
 * The filed returns the register holds for one charity, by registration number.
 *
 * `selectCharities` attaches returns to a *filter selection*; this answers for a
 * charity we already hold, which is the shape the annual-return backfill needs —
 * it starts from the client list, not from a query over the file.
 *
 * Matches on `registered_charity_number` or `organisation_number`, the same two
 * keys as `lookupCharityOperatingAreas`, because a record's `uk_charity`
 * identifier is written from whichever the promote path saw.
 *
 * Rows come back in the file's own column names (`count_employees`,
 * `income_donations_legacies`). `toExtractReturn` converts them to the extract
 * vocabulary the standardiser reads.
 */
export function lookupCharityReturns(
  identifier: string | number,
): { organisationNumber: number; returns: Record<string, unknown>[] } | null {
  const handle = open();
  if (!handle) return null;

  const numeric =
    typeof identifier === "number"
      ? identifier
      : Number(String(identifier).replace(/\D/g, ""));
  if (!numeric || !Number.isFinite(numeric)) return null;

  const row = handle.db
    .prepare(
      "select organisation_number from charity " +
        "where registered_charity_number = ? or organisation_number = ? limit 1",
    )
    .get(numeric, numeric) as { organisation_number: number } | undefined;
  if (!row) return null;

  return {
    organisationNumber: row.organisation_number,
    returns: handle.db
      .prepare(
        "select * from charity_return where organisation_number = ? order by period_end",
      )
      .all(row.organisation_number) as Record<string, unknown>[],
  };
}

/**
 * The register's profile facts for one charity, plus the classifications the
 * sector mapping reads.
 *
 * The annual-return lookup above answers "what did they file"; this answers
 * "what does the register say they *are*" — the filed activities description,
 * the registration date, the reporting status, and the "What the charity does"
 * labels. `profile-backfill.ts` is the only caller: an organisation already on
 * the client list never passes back through the import that would otherwise
 * write these, so this is how they reach a record that predates the bulk path.
 *
 * Matched on registration number or organisation number, the same pair
 * `lookupCharityReturns` accepts, so a caller holding either identifier gets
 * the same row.
 */
export type RegisterProfile = {
  organisationNumber: number;
  registeredCharityNumber: number | null;
  charityName: string;
  /** The charity's own filed description of its work. Externally authored free
   *  text — every reader must treat it as untrusted input. */
  activities: string | null;
  dateOfRegistration: string | null;
  reportingStatus: string | null;
  /** "What the charity does" values, in the extract's own spelling, for
   *  `bulkSector` to map. */
  classifications: string[];
};

export function lookupCharityProfile(identifier: string | number): RegisterProfile | null {
  const handle = open();
  if (!handle) return null;

  const numeric =
    typeof identifier === "number" ? identifier : Number(String(identifier).replace(/\D/g, ""));
  if (!numeric || !Number.isFinite(numeric)) return null;

  const row = handle.db
    .prepare(
      "select organisation_number, registered_charity_number, charity_name, " +
        "activities, date_of_registration, reporting_status from charity " +
        "where registered_charity_number = ? or organisation_number = ? limit 1",
    )
    .get(numeric, numeric) as
    | {
        organisation_number: number;
        registered_charity_number: number | null;
        charity_name: string;
        activities: string | null;
        date_of_registration: string | null;
        reporting_status: string | null;
      }
    | undefined;
  if (!row) return null;

  return {
    organisationNumber: row.organisation_number,
    registeredCharityNumber: row.registered_charity_number,
    charityName: row.charity_name,
    // Trimmed here, and blank read as absent: "" stored as a present value is
    // what every downstream `is null` check then misses — the same rule the
    // bulk import's own annotate step follows.
    activities: row.activities?.trim() || null,
    // The extract publishes a full timestamp; the column is a date.
    dateOfRegistration: row.date_of_registration?.slice(0, 10) || null,
    reportingStatus: row.reporting_status?.trim() || null,
    classifications: charityLabels(row.organisation_number, LABEL_KIND.what),
  };
}
