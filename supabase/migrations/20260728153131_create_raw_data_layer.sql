-- The following script creates the raw data layer tables for ingestion runs and raw source records. It also sets up row-level security policies to restrict access to these tables.

-- Ingestion runs: one row per import job execution
create table if not exists ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  api_source text not null check (api_source in ('charitybase','companies_house','360giving','find_that_charity','globalgiving','candid')),
  triggered_by text not null check (triggered_by in ('schedule','manual')),
  triggered_by_user_id uuid references users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  job_status text not null default 'running' check (job_status in ('running','completed','failed','partial')),
  records_fetched int not null default 0,
  records_inserted int not null default 0,
  records_skipped int not null default 0,
  records_failed int not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

-- Raw source records: untouched API responses, one row per record
create table if not exists raw_source_records (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid not null references ingestion_runs(id),
  record_source text not null check (record_source in ('charitybase','companies_house','360giving','find_that_charity','globalgiving','candid')),
  source_record_id text not null,
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  processing_status text not null default 'pending' check (processing_status in ('pending','validated','matched','rejected','error')),
  matched_organisation_id uuid references organisations(id),
  checksum text not null,
  source_last_modified timestamptz,
  ingestion_attempt int not null default 1,
  created_at timestamptz not null default now(),
  source_country text,
  source_registry_name text
);

create index if not exists idx_raw_source_records_ingestion_run on raw_source_records(ingestion_run_id);
create index if not exists idx_raw_source_records_source_record on raw_source_records(record_source, source_record_id);

-- Row level security: raw ingestion is admin-only (RLS matrix §3.5)
revoke all on public.ingestion_runs from anon, authenticated;
revoke all on public.raw_source_records from anon, authenticated;

alter table public.ingestion_runs enable row level security;
alter table public.raw_source_records enable row level security;

grant select, insert on public.ingestion_runs to authenticated;
grant select, delete on public.raw_source_records to authenticated;

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


