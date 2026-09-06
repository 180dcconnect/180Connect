/**
 * Turns a filter set into SQL against the companies-register file.
 *
 * The twin of src/lib/charity-register/sqlite-query.ts: the same clauses as
 * SQL text with bound parameters, the same "empty means everything" rule, the
 * same testability (returns `{ sql, params }`, never opens a database).
 *
 * One structural difference: SIC filtering reads the normalised
 * `company_sic` table, and it does so as `number in (select …)` rather than
 * the `exists (select … where s.number = c.number)` the charity twin uses.
 * Both are semi-joins, so both answer once for a company carrying two
 * selected codes — but on a table this size the plans are not close:
 *
 *   exists →  SEARCH c USING INDEX company_status_norm
 *             SEARCH s EXISTS USING COVERING INDEX company_sic_by_company
 *   in     →  LIST SUBQUERY: SEARCH s USING COVERING INDEX company_sic_by_sic
 *             SEARCH c USING sqlite_autoindex_company_1 (number=?)
 *
 * The correlated `exists` drives from `company` — all 716k live rows — and
 * probes `company_sic` once per row, which is the wrong direction and never
 * touches `company_sic_by_sic`. Written as `in`, SQLite reads only the rows
 * carrying the selected codes and probes `company` by primary key. Measured
 * on the September 2026 file (723,670 companies), three SIC codes plus the
 * live-status default: **909ms → 88ms**, same count. The screen recounts on
 * every filter change, so this is the difference between a live number and a
 * visible stall.
 */

import { parseFilters, type CompanyRegisterFilters } from "./filters.ts";

export type SqlQuery = { sql: string; params: (string | number)[] };

/** `?, ?, ?` for a list of bound values. */
function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

/**
 * The `where` clauses for a filter set, and the values to bind.
 *
 * Exported for its own tests. An unfiltered selection returns an empty clause
 * list — plus the live-only status default, which is itself a clause the
 * screen shows as a control rather than hides as a constant.
 */
export function buildWhere(input: CompanyRegisterFilters): {
  clauses: string[];
  params: (string | number)[];
} {
  const f = parseFilters(input);
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const nameTokens = f.names && f.names.length > 0
    ? f.names
    : f.nameContains
      ? [f.nameContains]
      : [];

  if (nameTokens.length > 0) {
    const nameClauses: string[] = [];
    for (const token of nameTokens) {
      // `%` and `_` are LIKE wildcards; someone searching "50_50 Club" means
      // the literal underscore. `\` is declared as the escape character below.
      const escaped = token.replace(/[%_\\]/g, (ch) => `\\${ch}`);
      nameClauses.push("c.name like ? escape '\\'");
      params.push(`%${escaped}%`);
    }
    if (nameClauses.length === 1) {
      clauses.push(nameClauses[0]);
    } else {
      clauses.push(`(${nameClauses.join(" or ")})`);
    }
  }

  if (f.townContains) {
    const escaped = f.townContains.replace(/[%_\\]/g, (ch) => `\\${ch}`);
    clauses.push("c.town like ? escape '\\'");
    params.push(`%${escaped}%`);
  }

  if (f.cicOnly) clauses.push("c.is_cic = 1");

  if (f.companyTypes?.length) {
    clauses.push(`c.cat_slug in (${placeholders(f.companyTypes.length)})`);
    params.push(...f.companyTypes);
  }

  if (f.sicCodes?.length) {
    // `in` and not a correlated `exists` — see the note at the top of this
    // file. Both dedupe; only this one reads company_sic_by_sic.
    clauses.push(
      `c.number in (select s.number from company_sic s ` +
        `where s.sic in (${placeholders(f.sicCodes.length)}))`,
    );
    params.push(...f.sicCodes);
  }

  if (f.postcodeAreas?.length) {
    clauses.push(`c.postcode_area in (${placeholders(f.postcodeAreas.length)})`);
    params.push(...f.postcodeAreas);
  }

  if (f.incorporatedFrom) {
    clauses.push("c.incorp_date >= ?");
    params.push(f.incorporatedFrom);
  }
  if (f.incorporatedTo) {
    clauses.push("c.incorp_date <= ?");
    params.push(f.incorporatedTo);
  }

  if (f.statuses && f.statuses.length > 0) {
    clauses.push(`c.status_norm in (${placeholders(f.statuses.length)})`);
    params.push(...f.statuses);
  }

  return { clauses, params };
}

function whereSql(clauses: string[]): string {
  return clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
}

/** How many companies the filter set selects. */
export function countQuery(filters: CompanyRegisterFilters): SqlQuery {
  const { clauses, params } = buildWhere(filters);
  return {
    sql: `select count(*) as total from company c ${whereSql(clauses)}`,
    params,
  };
}

/** Columns the preview list shows. */
const PREVIEW_COLUMNS = `
  c.number, c.name, c.cat_slug, c.status_norm, c.postcode, c.town,
  c.incorp_date, c.is_cic
`;

/**
 * A page of matching companies, ordered by name. (The charity preview leads
 * with income; companies publish no figures, so alphabetical is the honest
 * neutral order.)
 */
export function previewQuery(filters: CompanyRegisterFilters, limit = 25): SqlQuery {
  const { clauses, params } = buildWhere(filters);
  return {
    sql:
      `select ${PREVIEW_COLUMNS} from company c ${whereSql(clauses)} ` +
      `order by c.name limit ?`,
    params: [...params, limit],
  };
}

/**
 * Every matching company, for an import.
 *
 * Ordered by company number rather than name: a capped import needs a stable
 * order, and names are not unique.
 */
export function selectionQuery(filters: CompanyRegisterFilters, limit?: number): SqlQuery {
  const { clauses, params } = buildWhere(filters);
  const sql =
    `select c.* from company c ${whereSql(clauses)} order by c.number` +
    (limit === undefined ? "" : " limit ?");
  return { sql, params: limit === undefined ? params : [...params, limit] };
}

/**
 * Every SIC code the file holds, with the file's own title and how many
 * staged companies carry it. The picker shows the count beside each code —
 * it is the same "what does this criterion cost" signal as the headline
 * count, one level down.
 */
export function sicValuesQuery(): SqlQuery {
  return {
    sql:
      `select l.sic as sic, l.title as title, count(*) as companies ` +
      `from company_sic s join sic_label l on l.sic = s.sic ` +
      `group by l.sic, l.title order by l.sic`,
    params: [],
  };
}

/**
 * The register's own wording for a handful of specific codes.
 *
 * Distinct from `sicValuesQuery`, which is the picker's "every code in the
 * file, with how many companies carry it" — that one aggregates over
 * `company_sic`, a 1.06M-row table, to answer a question about the whole file.
 * This one answers "what do these three codes mean" for a single organisation
 * on the client record, and so reads `sic_label` alone (720 rows, primary key
 * on `sic`) and never touches `company_sic` at all.
 *
 * Codes the file does not carry simply do not come back; resolving that to a
 * displayable fallback is the caller's job, because the fallback is a display
 * decision and this layer only reports what the register says.
 */
export function sicTitlesQuery(codes: readonly string[]): SqlQuery {
  return {
    sql:
      `select sic, title from sic_label ` +
      `where sic in (${placeholders(codes.length)}) order by sic`,
    params: [...codes],
  };
}
