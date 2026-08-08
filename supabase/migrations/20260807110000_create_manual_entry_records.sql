-- Migration: create_manual_entry_records
-- Story: F036 Manual Client Entry. Sequence step 7.0 (create_quality).
-- Source: Data Model tab 03 MANUAL_ENTRY_RECORDS.
-- Compatibility: additive table and RPCs; no existing rows are changed.
-- Security: RPC-only writes, submitter/admin reads, audited status transitions.
-- Reversibility: ../rollback/20260807110000_create_manual_entry_records.down.sql

create type public.manual_review_status as enum ('pending', 'approved', 'rejected');

create table public.manual_entry_records (
  id uuid primary key default gen_random_uuid(),
  submitted_by_user_id uuid not null references public.users (id),
  legal_name text not null check (length(trim(legal_name)) between 1 and 200),
  country_code text not null default 'GB' check (country_code ~ '^[A-Z]{2}$'),
  website text,
  contact_email text,
  registry_name text,
  registry_number text,
  reason_for_manual_entry text not null check (length(trim(reason_for_manual_entry)) between 10 and 2000),
  converted_to_organisation_id uuid references public.organisations (id),
  review_status public.manual_review_status not null default 'pending',
  reviewed_by_user_id uuid references public.users (id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manual_entry_review_consistent check (
    (review_status = 'pending' and reviewed_by_user_id is null and reviewed_at is null)
    or (review_status <> 'pending' and reviewed_by_user_id is not null and reviewed_at is not null)
  ),
  constraint manual_entry_conversion_consistent check (
    converted_to_organisation_id is null or review_status = 'approved'
  )
);

create trigger manual_entry_records_set_updated_at
  before update on public.manual_entry_records
  for each row execute function public.set_updated_at();

create index manual_entry_records_review_status_idx
  on public.manual_entry_records (review_status, created_at desc);
create index manual_entry_records_submitter_idx
  on public.manual_entry_records (submitted_by_user_id, created_at desc);

revoke all on public.manual_entry_records from anon, authenticated;
grant select on public.manual_entry_records to authenticated;
alter table public.manual_entry_records enable row level security;

create policy manual_entry_records_select_own_or_admin on public.manual_entry_records
  for select to authenticated
  using (app.is_active_user() and (submitted_by_user_id = (select auth.uid()) or app.is_admin()));

create or replace function public.submit_manual_entry(
  p_legal_name text,
  p_country_code text,
  p_website text,
  p_contact_email text,
  p_registry_name text,
  p_registry_number text,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if not app.can_write() then
    raise exception 'CAM or admin access required' using errcode = '42501';
  end if;

  insert into public.manual_entry_records (
    submitted_by_user_id, legal_name, country_code, website, contact_email,
    registry_name, registry_number, reason_for_manual_entry
  ) values (
    v_actor, trim(p_legal_name), upper(trim(p_country_code)), nullif(trim(p_website), ''),
    nullif(trim(p_contact_email), ''), nullif(trim(p_registry_name), ''),
    nullif(trim(p_registry_number), ''), trim(p_reason)
  ) returning id into v_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (v_actor, 'manual_entry_submitted', 'manual_entry_records', v_id,
    jsonb_build_object('review_status', 'pending'));
  return v_id;
end;
$$;

create or replace function public.reject_manual_entry(p_entry_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.manual_review_status;
begin
  if not app.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  select review_status into v_old from public.manual_entry_records where id = p_entry_id for update;
  if v_old is null then raise exception 'manual entry not found' using errcode = 'P0002'; end if;
  if v_old <> 'pending' then raise exception 'manual entry has already been reviewed' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_notes, ''))) < 3 then raise exception 'review notes are required' using errcode = '22023'; end if;

  update public.manual_entry_records set
    review_status = 'rejected', reviewed_by_user_id = v_actor,
    reviewed_at = now(), review_notes = trim(p_notes)
  where id = p_entry_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (v_actor, 'manual_entry_rejected', 'manual_entry_records', p_entry_id,
    jsonb_build_object('from', v_old, 'to', 'rejected', 'notes', trim(p_notes)));
end;
$$;

revoke execute on function public.submit_manual_entry(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.submit_manual_entry(text,text,text,text,text,text,text) to authenticated;
revoke execute on function public.reject_manual_entry(uuid,text) from public, anon;
grant execute on function public.reject_manual_entry(uuid,text) to authenticated;
