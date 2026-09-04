/**
 * The shape of the register file.
 *
 * Kept beside the query code rather than inside the build script, because the
 * two have to agree exactly and the reader is the one that breaks confusingly
 * when they drift. `SCHEMA_VERSION` is written into the file's `meta` table and
 * checked on open, so a file built by an older commit is refused with a clear
 * message instead of returning wrong counts.
 *
 * ── Why labels are interned ──
 *
 * The register repeats 487 distinct strings — "Education/training",
 * "Sheffield City" — across 2.3 million classification and area rows. Storing
 * an integer per link rather than the text is what keeps the file at ~182MB.
 * It is the same information, written once.
 *
 * `kind` carries the register's own vocabulary: "What", "Who", "How" for the
 * three classification dimensions, and "Local Authority", "Region", "Country"
 * for areas of operation. The filter screen offers those verbatim, so nothing
 * has to be mapped into a taxonomy of ours that could fall out of step.
 */

/** Bumped whenever the tables change shape. Written to `meta.schema_version`. */
export const SCHEMA_VERSION = "1";

export const REGISTER_SCHEMA = `
create table if not exists charity (
  organisation_number        integer primary key,
  registered_charity_number  integer,
  charity_name               text not null,
  charity_type               text,
  reporting_status           text,
  date_of_registration       text,
  -- Null means the register published no figure. Never zero, never "small":
  -- reading it as small is what once hid 238 charities local to the branch.
  latest_income              real,
  latest_expenditure         real,
  latest_period_start        text,
  latest_period_end          text,
  postcode                   text,
  -- Letters before the first digit: "S" for S1 2HE, "SA" for SA1 1AA. Stored so
  -- an area filter is exact — a prefix match on "S" also selects SA, SE, SK, SL,
  -- SO, SW and SY, about a tenth of the register.
  postcode_area              text,
  address_lines              text,
  contact_email              text,
  contact_phone              text,
  contact_website            text,
  company_number             text,
  is_cio                     integer,
  insolvent                  integer,
  in_administration          integer,
  activities                 text
);

create table if not exists label (
  id    integer primary key,
  kind  text not null,
  value text not null
);

create table if not exists charity_label (
  organisation_number integer not null,
  label_id            integer not null
);

create table if not exists charity_return (
  organisation_number integer not null,
  period_start        text not null,
  period_end          text not null,
  total_income        real,
  total_expenditure   real,
  income_donations_legacies         real,
  income_charitable_activities      real,
  income_other_trading              real,
  income_investment                 real,
  income_endowments                 real,
  income_other                      real,
  income_govt_grants                real,
  income_govt_contracts             real,
  expenditure_charitable_activities real,
  expenditure_raising_funds         real,
  expenditure_governance            real,
  expenditure_grants_institutions   real,
  expenditure_investment_management real,
  expenditure_other                 real,
  filing_date             text,
  count_employees         integer,
  count_volunteers        integer,
  receives_govt_grants    integer,
  receives_govt_contracts integer,
  count_govt_grants       integer,
  count_govt_contracts    integer,
  primary key (organisation_number, period_end)
) without rowid;

create table if not exists meta (
  key   text primary key,
  value text not null
);
`;

/**
 * Built after the rows are in: creating an index once over a full table is far
 * cheaper than maintaining it across a million inserts.
 *
 * `charity_label (label_id, organisation_number)` is the one that matters — the
 * classification and area filters all read "which charities carry this label",
 * and that index answers it without touching the charity table.
 */
export const REGISTER_SCHEMA_INDEXES = `
create index if not exists charity_label_by_label on charity_label (label_id, organisation_number);
create index if not exists charity_label_by_charity on charity_label (organisation_number, label_id);
create index if not exists charity_income on charity (latest_income);
create index if not exists charity_postcode_area on charity (postcode_area);
create index if not exists charity_registered on charity (date_of_registration);
create unique index if not exists label_kind_value on label (kind, value);
`;
