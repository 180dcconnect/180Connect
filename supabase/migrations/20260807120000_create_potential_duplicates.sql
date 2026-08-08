-- Migration: create_potential_duplicates
-- Story: F042 Deduplicate Clients (#42)
-- Spec: docs/rls-permission-matrix.md §3.15
--
-- WHAT THIS CLOSES:
--   write-organisations.ts (F041) inserts every pending raw_source_records row as a
--   new organisations row with no check for "does this charity already exist from
--   another source" — flagged explicitly in that file's header as F042's job. This
--   migration is the storage half of closing that gap: a table to hold a flagged
--   possible match, and an admin-only RPC to decide it. The matching logic itself is
--   src/lib/dedup/match-organisations.ts (pure, tested, no database) — this table is
--   what the ingestion pipeline writes to when that function finds a candidate.
--
-- WHY A SEPARATE TABLE, NOT A COLUMN ON raw_source_records:
--   raw_source_records already reserves matched_organisation_id for exactly this
--   ("null until a downstream matching process confirms which organisations row this
--   record corresponds to" — see that column's comment). This table is the decision
--   record layered on top: who reviewed it, what they decided, when, and why — the
--   same reason SUPPRESSIONS is a table of its own rather than a column on
--   ORGANISATIONS. raw_source_records.matched_organisation_id is set the moment a
--   candidate is found (status 'matched'); this table tracks the admin's review of
--   that candidate.
--
-- WHO WRITES A ROW:
--   Only the ingestion pipeline (service_role, same as raw_source_records itself) —
--   there is no end-user "flag a duplicate" action, this is a machine-detected
--   candidate. An admin's only write is the decision, via decide_duplicate_flag.
--
-- THE 'not_duplicate' PATH:
--   Confirming a duplicate needs no further write — the candidate correctly never
--   became a second organisations row. Dismissing one is different: the raw record
--   really should become a new organisation, and the pipeline already knows how to do
--   that (promotePendingCharityCommissionRecords) — it just skipped this record on the
--   run that flagged it. decide_duplicate_flag resets that raw_source_records row to
--   'pending' with matched_organisation_id cleared, so the next promote run picks it
--   up. To stop it re-flagging against the same organisation forever,
--   match-organisations.ts's findDuplicateMatch takes an excludeOrganisationIds set,
--   and the promote loop populates it from every 'not_duplicate' decision already on
--   file for that raw record (loadDismissedMatches).
--
-- KNOWN GAP, NOT CLOSED HERE (flagged, not silently skipped — same convention as
--   write-organisations.ts's own header): F042's AC3 is "two records that are true
--   duplicates never both remain as separate active clients." Confirming a duplicate
--   here correctly stops a *new* row being created, but there is currently no way to
--   mark an *existing* organisations row inactive/merged if two already-separate rows
--   turn out to be the same charity (e.g. one from CharityBase, one entered manually,
--   both already promoted before this migration existed). organisations has no
--   inactive/merged status column; adding one is a separate schema decision, not
--   covered by the approval this migration has (see approval record below), and is
--   raised here as an open question rather than decided unilaterally.
--
-- Schema change approval record (SOP §7):
--   Change        | Add POTENTIAL_DUPLICATES table + decide_duplicate_flag RPC.
--   Reason        | F042 — flag a likely cross-source duplicate for admin review
--                 | instead of silently inserting a second organisations row.
--   Compatibility | New table, no FKs from existing tables. Adds one more write path
--                 | to raw_source_records (processing_status/matched_organisation_id),
--                 | already nullable/mutable columns with no existing UPDATE grant to
--                 | authenticated — this migration keeps that: only service_role and
--                 | this SECURITY DEFINER RPC touch them.
--   Data migration| None.
--   Security      | RLS on; SELECT admin-only (raw_payload joins expose third-party
--                 | data, same reasoning as raw_source_records §3.5); no INSERT/UPDATE
--                 | grant to authenticated — INSERT is service_role only (ingestion
--                 | pipeline), UPDATE is decide_duplicate_flag only.
--   Documentation | Approved by Bashir (Project Leader), 7 Aug 2026. Not yet reflected
--                 | in the Data Model spreadsheet — flag to Bashir to add
--                 | POTENTIAL_DUPLICATES to tab 04 + tab 02 before/alongside merge,
--                 | same as this repo's other spreadsheet-pending tables.
--
-- Reversibility: paired rollback in ../rollback/20260807120000_create_potential_duplicates.down.sql

create table public.potential_duplicates (
  id                       uuid primary key default gen_random_uuid(),
  raw_source_record_id     uuid not null references public.raw_source_records (id),
  matched_organisation_id  uuid not null references public.organisations (id),
  matched_on               text not null check (matched_on in ('registration_number', 'name_and_postcode')),
  status                   text not null default 'pending'
                             check (status in ('pending', 'confirmed_duplicate', 'not_duplicate')),
  decided_by               uuid references public.users (id),
  decided_at               timestamptz,
  decision_note            text,
  created_at               timestamptz not null default now(),

  -- Decision fields travel together, same reasoning as suppressions_decision_consistent.
  constraint potential_duplicates_decision_consistent check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

comment on table public.potential_duplicates is
  'F042: a raw_source_records row the matching logic (src/lib/dedup/match-organisations.ts) '
  'thinks is the same charity as an existing organisations row. Written by the ingestion '
  'pipeline (service_role) when a match is found; decided by an admin via '
  'decide_duplicate_flag, which is the only write path for status/decided_by/decided_at.';
comment on column public.potential_duplicates.matched_on is
  'Why the pipeline flagged this pair: an overlapping registration number, or a '
  'normalised name + postcode match. Shown to the admin reviewing the flag.';

create unique index potential_duplicates_raw_record_open_idx
  on public.potential_duplicates (raw_source_record_id) where status = 'pending';
create index potential_duplicates_matched_org_idx
  on public.potential_duplicates (matched_organisation_id);
create index potential_duplicates_pending_idx
  on public.potential_duplicates (created_at) where status = 'pending';

-- Revoke before grant (MIGRATIONS.md RLS recipe step 1).
revoke all on public.potential_duplicates from anon, authenticated;
grant select on public.potential_duplicates to authenticated;
grant select, insert on public.potential_duplicates to service_role;

alter table public.potential_duplicates enable row level security;

-- Admin-only read: same reasoning as raw_source_records (§3.5) — reviewing a flag means
-- seeing the incoming raw payload via a join, which is not CAM-visible data.
create policy potential_duplicates_select_admin on public.potential_duplicates
  for select to authenticated
  using (app.is_admin() and app.is_active_user());

-- No INSERT/UPDATE policy for authenticated: rows are written by the ingestion
-- pipeline (service_role) and decided only through decide_duplicate_flag below.

-- ---------------------------------------------------------------------------
-- decide_duplicate_flag — admin only
-- ---------------------------------------------------------------------------

create or replace function public.decide_duplicate_flag(
  p_potential_duplicate_id uuid,
  p_confirmed              boolean,
  p_note                   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor          uuid := (select auth.uid());
  v_raw_record_id  uuid;
  v_matched_org_id uuid;
  v_status         text;
  v_new_status     text;
begin
  if not app.is_admin() then
    raise exception 'only an admin may decide a potential duplicate'
      using errcode = '42501';
  end if;

  select raw_source_record_id, matched_organisation_id, status
    into v_raw_record_id, v_matched_org_id, v_status
    from public.potential_duplicates
   where id = p_potential_duplicate_id;

  if v_raw_record_id is null then
    raise exception 'potential duplicate % not found', p_potential_duplicate_id
      using errcode = 'P0002';
  end if;

  if v_status <> 'pending' then
    raise exception 'potential duplicate % is not pending', p_potential_duplicate_id
      using errcode = '55000';
  end if;

  v_new_status := case when p_confirmed then 'confirmed_duplicate' else 'not_duplicate' end;

  update public.potential_duplicates
     set status = v_new_status,
         decided_by = v_actor,
         decided_at = now(),
         decision_note = p_note
   where id = p_potential_duplicate_id;

  -- Dismissed as not-a-duplicate: the raw record should still become its own
  -- organisation. Reset it to 'pending' so the next promote run tries again — the
  -- pipeline excludes this specific (raw record, organisation) pair on retry by
  -- reading every 'not_duplicate' decision on file (see match-organisations.ts /
  -- loadDismissedMatches), so it will not re-flag against the same organisation.
  if not p_confirmed then
    update public.raw_source_records
       set processing_status = 'pending',
           matched_organisation_id = null
     where id = v_raw_record_id;
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_confirmed then 'duplicate_confirmed' else 'duplicate_dismissed' end,
    'organisations', v_matched_org_id,
    jsonb_build_object(
      'potential_duplicate_id', p_potential_duplicate_id,
      'raw_source_record_id', v_raw_record_id,
      'note', p_note
    )
  );
end;
$$;

comment on function public.decide_duplicate_flag(uuid, boolean, text) is
  'F042: admin confirms or dismisses a flagged potential duplicate. SECURITY DEFINER; '
  'self-checks app.is_admin(), rejects a non-pending target, resets the raw record to '
  'pending on dismissal so it gets promoted normally, writes audit_log in the same '
  'transaction.';

revoke execute on function public.decide_duplicate_flag(uuid, boolean, text) from public;
revoke execute on function public.decide_duplicate_flag(uuid, boolean, text) from anon;
grant execute on function public.decide_duplicate_flag(uuid, boolean, text) to authenticated;
