-- Migration: add_sic_codes
-- Sequence: no new step in Data Model tab "11 Supabase Migration Sequence" —
--   this adds one nullable column to ORGANISATIONS, created at step 4.0.
-- Story: give companies a "what does this organisation do" field at all.
--
-- WHY THIS MIGRATION EXISTS
--
-- 20260922121000_add_charity_activities.sql closed this hole for charities: the
-- Charity Commission publishes the charity's own description of its work, we
-- already ingested it, and it was being dropped at the standardize step. The
-- identical hole is open for companies, and it is worse, because no register
-- publishes a company purpose statement at all.
--
-- Companies House publishes SIC codes. They travel the whole pipeline already:
--   * the register import writes them into the payload as `sic_codes`
--     (src/lib/companies-register/import.ts, toRawPayload)
--   * the live API returns the same field on /company/{number}
--   * standardize/companies-house.ts declares them on RawCompaniesHouseRecord
--     and reads them to classify F047 source confidence
-- and are then discarded, for the reason its own header comment gives: "no
-- corresponding ORGANISATIONS field". This adds the field.
--
-- A SIC code is a classification, not a mission. 118 of the 413 companies on
-- staging share 85590 "Other education n.e.c." and 97 share 88990 "Other social
-- work activities without accommodation n.e.c." — it will not tell two CICs
-- apart. It is stored and surfaced as "nature of business" precisely so nothing
-- downstream reads it as a purpose statement. The company equivalent of
-- charity_activities is the CIC36 community interest statement, which is filed
-- as a scanned document and arrives in a separate migration.
--
-- WHY text[] AND NOT A JOIN TABLE
--
-- Same reasoning as charity_activities: a one-to-one fact about the
-- organisation, from a payload the import already fetches. A company carries
-- one to four codes (208 of 413 carry exactly one); ORGANISATION_IDENTIFIERS
-- exists because an identifier is looked up by value across organisations,
-- and nothing looks an organisation up by its SIC code — the register file
-- answers that question, over five million companies rather than our few
-- thousand.
--
-- WHY CODES AND NOT TITLES
--
-- The code is the register's fact; the title is the register's wording for it,
-- and docs/companies-register-import.md is explicit that the labels come from
-- the file rather than from us. Titles are resolved at read time from
-- sic_label in data/companies-register.sqlite (sicLabels() in
-- src/lib/companies-register/sqlite.ts), so a wording change in a monthly
-- rebuild reaches every stored row without a data migration. A code the file
-- does not know — possible for a company imported through the live API, since
-- the file keeps a filtered ~12% of the register — falls back to displaying
-- the bare code, which is what the register build itself does.
--
-- Schema change approval record (SOP §7):
--   Change        | One nullable text[] column, sic_codes, on
--                 | public.organisations.
--   Reason        | Companies arrive with no descriptive text whatsoever: all
--                 | 748 company rows on staging have a null mission and no
--                 | charity_activities (that column is the charity
--                 | regulator's, and a company row leaves it null by design).
--                 | The Client Booklet and the Stage 1 email are both told
--                 | "Mission: Not provided" for every one of them. SIC is the
--                 | only descriptive text either register publishes about a
--                 | company.
--   Compatibility | Additive and nullable, no default. No existing column
--                 | changes type or nullability, no existing select breaks.
--   Data migration| Yes, and required rather than optional — the same reason
--                 | charity_activities needed one. The promote path reaches an
--                 | organisation-annotating step only on the insert path, and
--                 | flagIfDuplicate (src/lib/standardize/write-organisations.ts)
--                 | `continue`s on a company already on the client list before
--                 | it. Re-running the import would therefore NOT fill this in
--                 | for the companies already promoted. The backfill below
--                 | copies the codes from the payloads those rows were
--                 | promoted from. Idempotent: it writes only where the column
--                 | is still null.
--   Security      | No new table, so no new RLS surface — ORGANISATIONS keeps
--                 | its existing column-agnostic policies. The value is a
--                 | published regulatory classification: a list of five-digit
--                 | SIC2007 codes. Nothing personal, nothing confidential,
--                 | nothing free-text — the closed vocabulary means this is
--                 | the one register field on the table that needs no
--                 | untrusted-input warning.
--   Documentation | Data Model tab "04 Entities" gains one field on
--                 | ORGANISATIONS. Already added to the spreadsheet; run
--                 | npm run export:data-model to refresh docs/data-model/.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260922130000_add_sic_codes.down.sql

alter table public.organisations
  add column if not exists sic_codes text[];

comment on column public.organisations.sic_codes is
  'Companies House SIC2007 industry classifications, five-digit codes only, as '
  'filed on the register. Null for a charity, which has no company '
  'registration, and for a company the register lists with none. Codes only: '
  'the human-readable title is the register file''s own wording and is '
  'resolved at read time from sic_label (sicLabels() in '
  'src/lib/companies-register/sqlite.ts), falling back to the bare code for a '
  'code the file does not carry. A classification, not a purpose statement — '
  'do not present it as a mission.';

-- Backfill from the payloads the existing rows were promoted from.
--
-- distinct on, not a bare UPDATE ... FROM join: an organisation can hold more
-- than one companies_house raw record (a re-ingestion writes a second row when
-- the checksum changed), and a plain join would let Postgres pick between them
-- arbitrarily. Newest received_at wins, so the value matches the most recent
-- snapshot and the migration produces the same result on every run.
--
-- jsonb_array_elements_text with ordinality, rather than a cast: the payload
-- holds a JSON array of strings and the stored order is the register's own.
-- `where jsonb_typeof(...) = 'array'` guards a payload that predates the field
-- or carries it as something else — a cast would raise and take the whole
-- migration with it.
--
-- nullif on the trimmed element keeps blanks out: an empty code is an absent
-- one, and "" in the array would defeat every downstream label lookup. A row
-- whose codes are all blank aggregates to null and is skipped by the
-- `is not null` below, rather than being stored as an empty array — null and
-- {} would otherwise be two spellings of "we know nothing".
with latest_companies_house as (
  select distinct on (r.matched_organisation_id)
         r.matched_organisation_id as organisation_id,
         r.raw_payload -> 'sic_codes' as codes
    from public.raw_source_records as r
   where r.record_source = 'companies_house'
     and r.matched_organisation_id is not null
   order by r.matched_organisation_id, r.received_at desc, r.id desc
),
parsed as (
  select l.organisation_id,
         (
           select array_agg(nullif(btrim(element.value), '') order by element.ordinality)
                    filter (where nullif(btrim(element.value), '') is not null)
             from jsonb_array_elements_text(l.codes)
                    with ordinality as element(value, ordinality)
         ) as codes
    from latest_companies_house as l
   where jsonb_typeof(l.codes) = 'array'
)
update public.organisations as o
   set sic_codes = parsed.codes
  from parsed
 where parsed.organisation_id = o.id
   and parsed.codes is not null
   and o.sic_codes is null;
