-- Migration: create_raw_data_layer
-- Sequence: Data Model tab "11 Supabase Migration Sequence" step 6.0 (create_ingestion).
-- Stories: F038 Modular Data Source Structure (#39) — the interface, runner, and
--   Companies House adapter live in src/lib/ingestion/. This migration is the storage
--   half: two tables, admin-only read, service-role-only write.
-- Spec: docs/rls-permission-matrix.md §3.5; Data Model tab "03 Raw Data".
--
-- WHY TWO TABLES AND NOT ONE:
--   ingestion_runs is one row per job execution — when it ran, how many records it
--   touched, whether it succeeded. raw_source_records is one row per fetched record,
--   linked back to the run that fetched it via ingestion_run_id. Splitting them lets a
--   run be inspected (success/failure, counts) without scanning every record it wrote,
--   and lets a record be traced back to exactly which run produced it.
--
-- WHY RAW_PAYLOAD IS NEVER TRANSFORMED:
--   raw_payload stores each source's API response exactly as received, untouched. Field
--   extraction (a canonical name, a matched organisation) happens downstream, in tables
--   this migration does not create (DATA_QUALITY_EVENTS, ENTITY_MATCH_CANDIDATES — future
--   tickets). Keeping the raw layer untouched means nothing is ever lost to a shaping bug;
--   the original response is always recoverable.
--
-- WHY ADMIN-ONLY, SERVICE-ROLE-ONLY WRITE:
--   raw_source_records holds unfiltered third-party payloads (matrix §3.5: "the sensitive
--   data check — a CAM select * must return zero rows"). No end-user role writes either
--   table; only the ingestion runner, holding the service-role key server-side, inserts
--   records. This mirrors the pattern in create_login_attempt: RLS restricts what
--   authenticated can read, and writes happen exclusively through privileged server code.
--
-- Schema change approval record (SOP §7):
--   Change        | Add INGESTION_RUNS + RAW_SOURCE_RECORDS tables, and the
--                 | public.data_source_name domain both use for their source column.
--   Reason        | F038: storage for raw records fetched by external-source adapters,
--                 | before validation/matching promotes them into ORGANISATIONS.
--   Compatibility | New tables, no FKs from existing tables. Written only by the
--                 | ingestion runner (src/lib/ingestion/runner.ts) via service_role.
--   Data migration| None.
--   Security      | RLS on both tables; SELECT admin-only; INSERT/UPDATE/DELETE on
--                 | raw_source_records via service_role only (no policy for
--                 | authenticated); DELETE on raw_source_records is admin-only per
--                 | matrix §3.5. ingestion_runs additionally grants authenticated
--                 | SELECT + INSERT so an admin-triggered manual run is recorded.
--   Documentation | Data Model tab "03 Raw Data" already described this schema before
--                 | this migration was written. Matrix row: §3.5.
--
-- Reversibility: paired rollback in ../rollback/20260728153131_create_raw_data_layer.down.sql

-- The source list, defined once.
--
-- A domain rather than the same `check (... in (...))` list copy-pasted onto both
-- ingestion_runs.api_source and raw_source_records.record_source. F038 AC1 is that
-- adding a source must not mean editing existing definitions: with this, a seventh
-- source is one `alter domain ... add constraint` in a new migration, and the two
-- columns pick it up. With duplicated checks it was two edits that could silently
-- drift apart — a value legal in one table and rejected by the other.
--
-- Mirrors DATA_SOURCES in src/lib/ingestion/type.ts; the two lists are the code and
-- database halves of the same enumeration and change together.
--
-- Not a Postgres enum type: adding a value to an enum cannot run inside a
-- transaction block in older servers and cannot be removed at all, whereas a domain
-- constraint can be replaced in an ordinary migration.
create domain public.data_source_name as text
  check (value in
    ('charitybase','companies_house','360giving','find_that_charity','globalgiving','candid'));

comment on domain public.data_source_name is
  'The external data sources the ingestion layer supports (F038). Shared by '
  'ingestion_runs.api_source and raw_source_records.record_source so the list has one '
  'definition. Adding a source: alter this domain in a new migration and add the same '
  'value to DATA_SOURCES in src/lib/ingestion/type.ts.';

create table public.ingestion_runs (
  id                    uuid primary key default gen_random_uuid(),
  api_source            public.data_source_name not null,
  triggered_by          text not null check (triggered_by in ('schedule','manual')),
  triggered_by_user_id  uuid references public.users (id),
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  job_status            text not null default 'running' check (job_status in
    ('running','completed','failed','partial')),
  records_fetched       integer not null default 0,
  records_inserted      integer not null default 0,
  records_skipped       integer not null default 0,
  records_failed        integer not null default 0,
  error_message         text,
  created_at            timestamptz not null default now()
);

comment on table public.ingestion_runs is
  'One row per ingestion job execution (F038). Tracks which source ran, when, and the '
  'outcome counts, without needing to scan raw_source_records to answer "did this run '
  'succeed". Written by the ingestion runner (src/lib/ingestion/runner.ts).';
comment on column public.ingestion_runs.job_status is
  'running while in progress; completed if every fetched record was processed; partial '
  'if the source itself truncated results (e.g. a search API''s result-count ceiling), '
  'not a runner failure; failed if the job threw before completing.';
comment on column public.ingestion_runs.error_message is
  'Set only on job_status = failed. Null otherwise — a run that partially succeeded is '
  'partial, not failed, and carries no error_message.';
comment on column public.ingestion_runs.records_inserted is
  'Rows written to raw_source_records by this run: new records plus records whose '
  'payload changed since the last run, so that fetched = inserted + skipped + failed '
  'reconciles. The Data Model wording is "new records"; there is no records_updated '
  'column to separate the two, and the runner logs the split to stdout.';
comment on column public.ingestion_runs.records_skipped is
  'Records re-fetched whose checksum was unchanged, so nothing was written.';

create table public.raw_source_records (
  id                     uuid primary key default gen_random_uuid(),
  ingestion_run_id       uuid not null references public.ingestion_runs (id),
  record_source          public.data_source_name not null,
  source_record_id       text not null,
  raw_payload            jsonb not null,
  received_at            timestamptz not null default now(),
  processing_status      text not null default 'pending' check (processing_status in
    ('pending','validated','matched','rejected','error')),
  matched_organisation_id uuid references public.organisations (id),
  checksum               text not null,
  source_last_modified   timestamptz,
  ingestion_attempt      integer not null default 1,
  created_at             timestamptz not null default now(),
  source_country         text,
  source_registry_name   text,
  constraint raw_source_records_source_record_unique
    unique (record_source, source_record_id)
);

comment on table public.raw_source_records is
  'One row per record fetched from an external source, stored exactly as received (F038). '
  'raw_payload is never transformed — extraction into a canonical organisation happens in '
  'downstream tables this migration does not create. Deduplicated on (record_source, '
  'source_record_id): a re-fetch with an unchanged checksum is skipped, a changed one '
  'upserts and increments ingestion_attempt.';
comment on column public.raw_source_records.raw_payload is
  'The source API''s response for this record, untouched. Never edit this column in '
  'application code — if a field needs correcting, correct it downstream, not here.';
comment on column public.raw_source_records.checksum is
  'sha256 of raw_payload with keys sorted, so identical data hashes identically regardless '
  'of the source API''s field order. Compared on each ingestion run to detect real changes '
  'and skip reprocessing unchanged records.';
comment on column public.raw_source_records.matched_organisation_id is
  'Null until a downstream matching process (not part of F038) confirms which '
  'organisations row this record corresponds to.';

create index raw_source_records_ingestion_run_idx
  on public.raw_source_records (ingestion_run_id);

-- Privileges — revoke first (matrix §2.1), then grant only what §3.5 allows.
revoke all on public.ingestion_runs from anon, authenticated;
revoke all on public.raw_source_records from anon, authenticated;

alter table public.ingestion_runs enable row level security;
alter table public.raw_source_records enable row level security;

-- authenticated: admin-only read on both; ingestion_runs additionally allows an
-- admin-triggered manual run to be recorded (INSERT). raw_source_records grants no
-- INSERT/UPDATE to authenticated at all — only service_role writes raw records; DELETE
-- is admin-only per matrix §3.5.
grant select, insert on public.ingestion_runs to authenticated;
grant select, delete on public.raw_source_records to authenticated;

-- service_role: full access, so the runner (holding this key server-side) can insert,
-- upsert on conflict, and update run status without RLS or grants standing in its way.
grant select, insert, update, delete on public.ingestion_runs to service_role;
grant select, insert, update, delete on public.raw_source_records to service_role;

create policy ingestion_runs_select on public.ingestion_runs
  for select to authenticated
  using (app.is_admin() and app.is_active_user());

create policy ingestion_runs_insert on public.ingestion_runs
  for insert to authenticated
  with check (app.is_admin() and app.is_active_user());

create policy raw_source_records_select on public.raw_source_records
  for select to authenticated
  using (app.is_admin() and app.is_active_user());

create policy raw_source_records_delete on public.raw_source_records
  for delete to authenticated
  using (app.is_admin() and app.is_active_user());

-- No UPDATE policy for authenticated on either table, and no INSERT policy on
-- raw_source_records: every write beyond an admin-triggered ingestion_runs row and an
-- admin DELETE happens through service_role, which bypasses RLS entirely.
