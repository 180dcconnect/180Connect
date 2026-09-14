/**
 * Turns a filter set into SQL against the register file.
 *
 * The Postgres version of this module built a PostgREST query; this builds the
 * same clauses as SQL text with bound parameters. The filter *model*
 * (filters.ts) is unchanged and still the single description of what can be
 * asked — only the thing being asked changed.
 *
 * Pure and node-testable: it returns `{ sql, params }` and never opens a
 * database. That is what lets the clause logic be asserted directly, which
 * matters more here than it did against PostgREST, because a mistake in a
 * hand-built `where` is silent — it returns a wrong count rather than an error.
 *
 * ── Two rules carried over from the model ──
 *
 *   1. An empty list means "do not filter on this", never "match nothing".
 *   2. Null income means the register published no figure. It is included by
 *      default, and excluded only when the user says so.
 */

import { parseFilters, type CharityRegisterFilters } from "./filters.ts";
import { lettersInOrderPattern, normalisedNameSql, searchWords } from "../register-search-term.ts";

export type SqlQuery = { sql: string; params: (string | number)[] };

/** How a label kind in the file maps to the filter model's dimensions. */
export const LABEL_KIND = {
  what: "What",
  who: "Who",
  how: "How",
  localAuthority: "Local Authority",
  region: "Region",
  country: "Country",
} as const;

/** `?, ?, ?` for a list of bound values. */
function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

/**
 * A clause matching charities that carry any of these labels.
 *
 * `exists` rather than a join: a charity carrying three of the selected causes
 * must appear once, not three times, and `exists` stops at the first match
 * instead of building rows to deduplicate afterwards.
 *
 * The label lookup is a nested `in (select …)` rather than a join onto `label`.
 * Joining made SQLite resolve the label text for every candidate row — 830ms on
 * a local-area count. As a subquery the tiny inner set (487 labels in total) is
 * evaluated once, and the outer test becomes an index seek on
 * charity_label (label_id, organisation_number).
 */
function labelClause(kind: string, values: string[], params: (string | number)[]): string {
  params.push(kind, ...values);
  return (
    `exists (select 1 from charity_label cl ` +
    `where cl.organisation_number = c.organisation_number and cl.label_id in ` +
    `(select id from label where kind = ? and value in (${placeholders(values.length)})))`
  );
}

/**
 * The `where` clauses for a filter set, and the values to bind.
 *
 * Exported for its own tests. Returns an empty clause list for an unfiltered
 * selection, which is how the screen opens: the whole register.
 */
export function buildWhere(input: CharityRegisterFilters): {
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
      // `%` and `_` are LIKE wildcards; someone searching "50_50 Club" means the
      // literal underscore. `\` is declared as the escape character below.
      const escaped = token.replace(/[%_\\]/g, (ch) => `\\${ch}`);
      nameClauses.push("c.charity_name like ? escape '\\'");
      params.push(`%${escaped}%`);
    }
    if (nameClauses.length === 1) {
      clauses.push(nameClauses[0]);
    } else {
      clauses.push(`(${nameClauses.join(" or ")})`);
    }
  }

  const hasIncomeBound = f.incomeMin !== null || f.incomeMax !== null;
  if (hasIncomeBound) {
    const bounds: string[] = [];
    if (f.incomeMin !== null && f.incomeMin !== undefined) {
      bounds.push("c.latest_income >= ?");
      params.push(f.incomeMin);
    }
    if (f.incomeMax !== null && f.incomeMax !== undefined) {
      bounds.push("c.latest_income <= ?");
      params.push(f.incomeMax);
    }
    clauses.push(
      f.includeUnpublishedIncome === false
        ? bounds.join(" and ")
        : `((${bounds.join(" and ")}) or c.latest_income is null)`,
    );
  }

  if (f.registeredFrom) {
    clauses.push("c.date_of_registration >= ?");
    params.push(f.registeredFrom);
  }
  if (f.registeredTo) {
    clauses.push("c.date_of_registration <= ?");
    params.push(f.registeredTo);
  }

  // Location. Postcode area and declared area of operation are separate signals
  // and either is enough by default — a charity based here that never filled in
  // its area of operation is still on the doorstep, and one that names Sheffield
  // while registered to a London accountant is still working here.
  const locationParts: string[] = [];
  const postcodeAreas = f.postcodeAreas ?? [];
  if (postcodeAreas.length > 0) {
    locationParts.push(`c.postcode_area in (${placeholders(postcodeAreas.length)})`);
    params.push(...postcodeAreas);
  }
  for (const level of ["localAuthority", "region", "country"] as const) {
    const values = f.areas?.[level] ?? [];
    if (values.length > 0) locationParts.push(labelClause(LABEL_KIND[level], values, params));
  }
  if (locationParts.length > 0) {
    clauses.push(
      locationParts.length === 1
        ? locationParts[0]
        : `(${locationParts.join(f.locationMatch === "all" ? " and " : " or ")})`,
    );
  }

  // Classifications: each dimension is its own AND, values within one are OR,
  // which is what ticking three causes means.
  for (const dimension of ["what", "who", "how"] as const) {
    const values = f.classifications?.[dimension] ?? [];
    if (values.length > 0) clauses.push(labelClause(LABEL_KIND[dimension], values, params));
  }

  if (f.charityTypes?.length) {
    clauses.push(`c.charity_type in (${placeholders(f.charityTypes.length)})`);
    params.push(...f.charityTypes);
  }
  if (f.hasFiledAccounts) clauses.push("c.latest_period_end is not null");
  if (f.excludeInsolvent) clauses.push("c.insolvent = 0 and c.in_administration = 0");

  return { clauses, params };
}

function whereSql(clauses: string[]): string {
  return clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
}

/** How many charities the filter set selects. */
export function countQuery(filters: CharityRegisterFilters): SqlQuery {
  const { clauses, params } = buildWhere(filters);
  return {
    sql: `select count(*) as total from charity c ${whereSql(clauses)}`,
    params,
  };
}

/** Columns the preview list shows. Deliberately not `*`: activities is large. */
const PREVIEW_COLUMNS = `
  c.organisation_number, c.registered_charity_number, c.charity_name,
  c.latest_income, c.postcode, c.date_of_registration, c.activities,
  c.contact_website
`;

/**
 * A page of matching charities.
 *
 * Ordered by income descending with nulls last, so the preview leads with the
 * most substantial matches — with no income floor the register is dominated by
 * very small charities and every preview would otherwise look alike.
 */
export function previewQuery(filters: CharityRegisterFilters, limit = 25): SqlQuery {
  const { clauses, params } = buildWhere(filters);
  return {
    sql:
      `select ${PREVIEW_COLUMNS} from charity c ${whereSql(clauses)} ` +
      `order by c.latest_income is null, c.latest_income desc limit ?`,
    params: [...params, limit],
  };
}

/**
 * Every matching charity, for an import.
 *
 * Ordered by organisation_number rather than income: a capped import needs a
 * stable order, and income is not unique (thousands of nulls, many charities
 * sharing a round figure).
 */
export function selectionQuery(filters: CharityRegisterFilters, limit?: number): SqlQuery {
  const { clauses, params } = buildWhere(filters);
  const sql =
    `select c.* from charity c ${whereSql(clauses)} order by c.organisation_number` +
    (limit === undefined ? "" : " limit ?");
  return { sql, params: limit === undefined ? params : [...params, limit] };
}

/** Every distinct value the file holds for one label kind, for the pickers. */
export function labelValuesQuery(kind: string): SqlQuery {
  return {
    sql: "select value from label where kind = ? order by value",
    params: [kind],
  };
}

/** `charity_name` as `searchWords` compares it. */
const CHARITY_NAME_NORMALISED = normalisedNameSql("charity_name");

/** Shorter than this and a contains-scan is not worth running. */
export const SEARCH_MIN_LENGTH = 2;

/**
 * `%`, `_` and the escape character itself, escaped for a LIKE pattern.
 *
 * Without this a term containing `50%` searches for "50 followed by anything",
 * and a term ending in a backslash produces a pattern SQLite rejects outright —
 * an unhandled throw out of a search box. Lives here rather than in `sqlite.ts`
 * so the escaping is testable without a database, like every other clause rule.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Columns the name search returns — everything an add-a-client form needs. */
const SEARCH_COLUMNS = `
  organisation_number, registered_charity_number, charity_name, charity_type,
  reporting_status, date_of_registration, latest_income, postcode, address_lines,
  contact_email, contact_website, company_number, is_cio, insolvent,
  in_administration, activities
`;

/**
 * Finds charities by name, postcode, or both.
 *
 * This is the *other* direction from `lookupCharityProfile`, which parses digits
 * out of its argument and so can only answer a question you already knew the
 * number to. Everything else that could find a charity by name talks to the
 * network (the live Commission API, F037's URL import); the register file is
 * already in the deployment and holds all 171,800 of them, but nothing could
 * search it.
 *
 * ── Why this is a scan, and why that is fine ──
 *
 * `charity_name`'s index is `collate nocase`, which SQLite can only use for an
 * equality test — and `LIKE` cannot use a `nocase` index at all, only a
 * `BINARY` one. So both an equality and a contains test read the table.
 * Measured against the 2026-09 file (171,800 rows): 40–75ms, in-process, on a
 * file that never leaves the server. The import screen's own filter preview
 * already spends 100–200ms and is described as cheap enough to run on every
 * keystroke. A trigram index to shave that is not worth the file size.
 *
 * ── Ordering is relevance, not recency or size ──
 *
 * An exact name first, then names starting with the term, then names containing
 * it. Somebody searching "Sheffield" wants the charity *called* Sheffield
 * something before the fifty with Sheffield in the middle of their name, and
 * this `case` is the whole of that judgement.
 *
 * ── The postcode rule ──
 *
 * A postcode typed without a space is an outward code: "S1" means the S1
 * district. Matching that as a bare prefix also returns S10, S11 and S12 —
 * three different districts of Sheffield, none of them asked for. With a space
 * it is the beginning of a full postcode and a plain prefix is exactly right.
 */
export function charitySearchQuery(
  input: {
    name?: string | null;
    postcode?: string | null;
    /** A UK town, matched against the register's address lines. */
    town?: string | null;
    /** An exact registered charity number. When set, it is the only clause. */
    registeredNumber?: number | null;
  },
  limit = 8,
): SqlQuery {
  const name = (input.name ?? "").trim();
  // Collapsed to single spaces so "S1  4FW" and "S1 4FW" behave the same.
  const postcode = (input.postcode ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const town = (input.town ?? "").trim().toLowerCase();

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const byNumber =
    typeof input.registeredNumber === "number" && Number.isInteger(input.registeredNumber);
  if (byNumber) {
    // Indexed (`charity_reg_number`), exact, and the whole question.
    clauses.push("registered_charity_number = ?");
    params.push(input.registeredNumber as number);
  }

  // ── Name, word by word ──
  //
  // Each typed word must appear somewhere in the name, in any order, compared
  // after both sides drop apostrophes and full stops and read `&` as "and" — so
  // "St Marys" finds "ST. MARY'S" and "Trust Sheffield" finds "Sheffield Trust".
  // A term with no usable words ("a_b") falls back to the literal contains-match.
  if (!byNumber && name.length >= SEARCH_MIN_LENGTH) {
    const words = searchWords(name);
    if (words.length > 0) {
      for (const word of words) {
        // Cheap letters-in-order test first, so the normalising only runs on
        // names that could match (see `lettersInOrderPattern`).
        clauses.push("lower(charity_name) like ?");
        params.push(lettersInOrderPattern(word));
        clauses.push(`${CHARITY_NAME_NORMALISED} like ? escape '\\'`);
        params.push(`%${escapeLike(word)}%`);
      }
    } else {
      clauses.push("lower(charity_name) like ? escape '\\'");
      params.push(`%${escapeLike(name.toLowerCase())}%`);
    }
  }

  if (!byNumber && town.length >= SEARCH_MIN_LENGTH) {
    clauses.push("lower(coalesce(address_lines, '')) like ? escape '\\'");
    params.push(`%${escapeLike(town)}%`);
  }

  if (!byNumber && postcode.length >= SEARCH_MIN_LENGTH) {
    if (postcode.includes(" ")) {
      clauses.push("lower(coalesce(postcode, '')) like ? escape '\\'");
      params.push(`${escapeLike(postcode)}%`);
    } else {
      clauses.push(
        "(lower(coalesce(postcode, '')) like ? escape '\\' " +
          "or lower(coalesce(postcode, '')) = ?)",
      );
      params.push(`${escapeLike(postcode)} %`, postcode);
    }
  }

  return {
    sql:
      // `0` rather than an empty clause list: a caller that passes a one-letter
      // term in both boxes must get no rows, not a run-on `where order by` that
      // SQLite rejects. Making the builder total means no call site has to
      // remember the guard.
      `select ${SEARCH_COLUMNS} from charity where ${clauses.length > 0 ? clauses.join(" and ") : "0"} ` +
      "order by " +
      "  case " +
      "    when lower(charity_name) = ? then 0 " +
      "    when lower(charity_name) like ? escape '\\' then 1 " +
      "    else 2 " +
      "  end, " +
      "  lower(charity_name) " +
      "limit ?",
    params: [
      ...params,
      escapeLike(name.toLowerCase()),
      `${escapeLike(name.toLowerCase())}%`,
      Math.max(1, Math.min(limit, 25)),
    ],
  };
}
