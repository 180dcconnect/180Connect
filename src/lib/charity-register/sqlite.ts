import "server-only";

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { SCHEMA_VERSION } from "./sqlite-schema.ts";
import {
  countQuery,
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

  const path = candidatePaths().find((candidate) => existsSync(candidate));
  if (!path) {
    missingReason = `No register file found. Looked in: ${candidatePaths().join(", ")}`;
    return null;
  }

  const db = new DatabaseSync(path, { readOnly: true });

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
