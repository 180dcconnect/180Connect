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

import { COMPANIES_SCHEMA_VERSION } from "./sqlite-schema.ts";
import {
  countQuery,
  previewQuery,
  selectionQuery,
  sicValuesQuery,
} from "./sqlite-query.ts";
import type { CompanyRegisterFilters } from "./filters.ts";

/**
 * Opens the companies-register file and answers questions about it.
 *
 * The twin of src/lib/charity-register/sqlite.ts: the file is built in CI
 * and ships inside the deployment, so it is read-only, local, and guaranteed
 * to be the one this build was tested against. Nothing here writes, and
 * nothing here talks to Supabase.
 *
 * `server-only`: this must never be pulled into a browser bundle. It reads
 * the filesystem.
 */

/**
 * Where the file is looked for, in order.
 *
 * `COMPANIES_REGISTER_DB_PATH` first so a deployment can point somewhere else
 * without a code change — that is the seam the `/tmp` fallback would use if a
 * platform ever refuses a file this size inside the bundle.
 */
function candidatePaths(): string[] {
  const configured = process.env.COMPANIES_REGISTER_DB_PATH?.trim();
  return [
    ...(configured ? [configured] : []),
    join(process.cwd(), "data", "companies-register.sqlite"),
    "/tmp/companies-register.sqlite",
  ];
}

export type CompaniesRegisterMeta = {
  builtOn: string | null;
  sourceMonth: string | null;
  companies: number;
  sicLabels: number;
  path: string;
};

/**
 * One connection per process, opened on first use.
 *
 * SQLite reads are synchronous and the file is read-only, so there is no pool
 * and no contention to manage: concurrent requests in the same function
 * instance share one handle safely.
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
    missingReason = `No companies-register file found. Looked in: ${candidatePaths().join(", ")}`;
    return null;
  }

  const db = new DatabaseSyncClass(path, { readOnly: true });

  // A file built by an older commit would answer queries with the wrong shape
  // rather than failing, so the version is checked once, on open.
  const version = db
    .prepare("select value from meta where key = 'schema_version'")
    .get() as { value?: string } | undefined;
  if (version?.value !== COMPANIES_SCHEMA_VERSION) {
    db.close();
    missingReason =
      `Companies-register file at ${path} is schema version ${version?.value ?? "unknown"}, ` +
      `but this build expects ${COMPANIES_SCHEMA_VERSION}. Refresh the register.`;
    return null;
  }

  cached = { db, path };
  return cached;
}

/** Why the register is unavailable, or null when it is fine. */
export function companiesRegisterUnavailableReason(): string | null {
  open();
  return cached ? null : missingReason;
}

/** What the file is and when it was built, or null when there is no file. */
export function companiesRegisterMeta(): CompaniesRegisterMeta | null {
  const handle = open();
  if (!handle) return null;
  const rows = handle.db.prepare("select key, value from meta").all() as {
    key: string;
    value: string;
  }[];
  const meta = new Map(rows.map((row) => [row.key, row.value]));
  return {
    builtOn: meta.get("built_on") ?? null,
    sourceMonth: meta.get("source_month") ?? null,
    companies: Number(meta.get("companies") ?? 0),
    sicLabels: Number(meta.get("sic_labels") ?? 0),
    path: handle.path,
  };
}

export type RegisterCompany = {
  number: string;
  name: string;
  cat_slug: string | null;
  status_raw: string | null;
  status_norm: string | null;
  incorp_date: string | null;
  postcode: string | null;
  postcode_area: string | null;
  town: string | null;
  address_line_1: string | null;
  is_cic: number | null;
};

export type RegisterCompanyPreviewRow = Pick<
  RegisterCompany,
  | "number"
  | "name"
  | "cat_slug"
  | "status_norm"
  | "postcode"
  | "town"
  | "incorp_date"
  | "is_cic"
>;

/** How many companies the filters select. Fast enough to run on every change. */
export function countCompanies(filters: CompanyRegisterFilters): number {
  const handle = open();
  if (!handle) return 0;
  const { sql, params } = countQuery(filters);
  const row = handle.db.prepare(sql).get(...params) as { total?: number } | undefined;
  return Number(row?.total ?? 0);
}

export function previewCompanies(
  filters: CompanyRegisterFilters,
  limit = 25,
): RegisterCompanyPreviewRow[] {
  const handle = open();
  if (!handle) return [];
  const { sql, params } = previewQuery(filters, limit);
  return handle.db.prepare(sql).all(...params) as RegisterCompanyPreviewRow[];
}

/** Every company the filters select, with its SIC codes attached. */
export function selectCompanies(
  filters: CompanyRegisterFilters,
  limit?: number,
): { company: RegisterCompany; sicCodes: string[] }[] {
  const handle = open();
  if (!handle) return [];

  const { sql, params } = selectionQuery(filters, limit);
  const companies = handle.db.prepare(sql).all(...params) as RegisterCompany[];
  if (companies.length === 0) return [];

  // One statement, reused per company, rather than a single query with a huge
  // `in (...)` list: SQLite caps bound parameters, an import can select
  // thousands of companies, and a prepared statement makes the per-row cost
  // negligible anyway.
  const sicFor = handle.db.prepare(
    "select sic from company_sic where number = ? order by sic",
  );
  return companies.map((company) => ({
    company,
    sicCodes: (sicFor.all(company.number) as { sic: string }[]).map((row) => row.sic),
  }));
}

export type SicValue = { sic: string; title: string; companies: number };

/**
 * Every SIC code the file holds, with the file's own title and how many
 * staged companies carry it. The picker's options and their per-code costs,
 * from one indexed pass.
 */
export function sicValues(): SicValue[] {
  const handle = open();
  if (!handle) return [];
  const { sql, params } = sicValuesQuery();
  return handle.db.prepare(sql).all(...params) as SicValue[];
}

/** The SIC codes one company carries, in code order. */
export function companySicCodes(companyNumber: string): string[] {
  const handle = open();
  if (!handle) return [];
  const rows = handle.db
    .prepare("select sic from company_sic where number = ? order by sic")
    .all(companyNumber) as { sic: string }[];
  return rows.map((row) => row.sic);
}
