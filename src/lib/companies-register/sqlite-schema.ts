/**
 * The shape of the companies-register file.
 *
 * Kept beside the row vocabulary rather than inside the build script, because
 * the two have to agree exactly and the reader (Phase B's sqlite.ts) is the
 * one that breaks confusingly when they drift. `COMPANIES_SCHEMA_VERSION` is
 * written into the file's `meta` table and checked on open, so a file built
 * by an older commit is refused with a clear message instead of returning
 * wrong counts — the same contract the charity register file keeps.
 *
 * ── Why two tables ──
 *
 * A company carries up to four SIC codes and the SIC filter asks the reverse
 * question ("which companies carry this code"), so codes live in their own
 * `company_sic` table with the composite index answering both directions.
 * Everything else about a company is one row in `company`.
 *
 * `status_norm` speaks the API vocabulary ("active", "liquidation"), not the
 * file's display text — see normalizeCompanyStatus. The raw text stays in
 * `status_raw` so a future normalisation bug is diagnosable from the file.
 * The raw category wording is not stored (it averages 30 bytes a row for no
 * runtime reader), but its slug mapping is pinned by the census test on
 * CATEGORY_TO_SLUG and any unmapped wording lands in `meta.unmapped_categories`.
 *
 * `is_cic` duplicates what `cat_slug = 'community-interest-company'` already
 * says, deliberately: the import screen's most common filter is "CICs", and
 * an indexed integer answers it without string comparisons.
 */

/** Bumped whenever the tables change shape. Written to `meta.schema_version`. */
export const COMPANIES_SCHEMA_VERSION = "1";

export const COMPANIES_SCHEMA = `
create table if not exists company (
  number          text primary key,
  name            text not null,
  cat_slug        text,
  status_raw      text,
  status_norm     text,
  incorp_date     text,
  postcode        text,
  -- Letters before the first digit: "S" for S1 2HE, "SA" for SA1 1AA. Stored
  -- so an area filter is exact — a prefix match on "S" also selects SA, SE,
  -- SK, SL, SO, SW and SY, about a tenth of the register.
  postcode_area   text,
  town            text,
  address_line_1  text,
  is_cic          integer
);

create table if not exists company_sic (
  number text not null,
  -- 5-digit SIC2007 only. "None Supplied" and legacy 4-digit codes never
  -- reach this table — see parseSicCode.
  sic    text not null
);

-- One row per distinct SIC code in the file, with the file's own description
-- ("86101 - Hospital activities", first-seen wins). The SIC picker reads this
-- at runtime, so its labels are the register's wording, not ours — the same
-- internship the charity file does for classifications and areas.
create table if not exists sic_label (
  sic   text primary key,
  title text not null
);

create table if not exists meta (
  key   text primary key,
  value text not null
);
`;

/**
 * Built after the rows are in: creating an index once over a full table is
 * far cheaper than maintaining it across hundreds of thousands of inserts.
 *
 * `company_sic (sic, number)` is the one that matters — the SIC filter reads
 * "which companies carry this code", and that index answers it without
 * touching the company table.
 */
export const COMPANIES_SCHEMA_INDEXES = `
create index if not exists company_sic_by_sic on company_sic (sic, number);
create index if not exists company_sic_by_company on company_sic (number, sic);
create index if not exists company_postcode_area on company (postcode_area);
create index if not exists company_incorp_date on company (incorp_date);
create index if not exists company_cat_slug on company (cat_slug);
create index if not exists company_is_cic on company (is_cic);
create index if not exists company_status_norm on company (status_norm);
`;
