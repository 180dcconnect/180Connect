-- Migration: create_entity_match_candidates
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
-- WHY ENTITY_MATCH_CANDIDATES, NOT A NEW TABLE:
--   This table already exists in the Data Model (tab 03 Raw Data), added 23 Jul 2026
--   — before this branch — as the reserved home for match-candidate rows generally,
--   including a richer future design (LLM-assisted scoring, source-priority conflict
--   resolution) than F042 builds today. An earlier version of this migration created
--   a new POTENTIAL_DUPLICATES table instead; Bashir (Project Leader) caught the
--   duplication in review, 9 Aug 2026, and asked for ENTITY_MATCH_CANDIDATES to be
--   used instead. This is that correction, before this migration ever reached a
--   shared environment (see supabase/MIGRATIONS.md: "never edited after they've been
--   applied to a shared environment" — this one hadn't been).
--
-- COLUMNS THIS MATCHER CANNOT HONESTLY FILL, AND WHY THEY'RE LEFT NULL:
--   match-organisations.ts's findDuplicateMatch is a binary check (registration number
--   overlap, or normalised name+postcode) — not the graduated, LLM-assisted matcher
--   the full ENTITY_MATCH_CANDIDATES design anticipates. So:
--     - match_score: not a real 0.0-1.0 confidence from this matcher. Approximated as
--       1.0 for a registration-number match (that signal is treated as certain
--       elsewhere in this codebase, e.g. match-organisations.ts's own comment) and 0.7
--       for a name+postcode match (fuzzy, not certain). A placeholder, not a computed
--       score — flagged here rather than presented as more precise than it is.
--     - match_method: the schema's enum is exact_charity_number / fuzzy_name /
--       address_match / manual. This matcher's "registration_number" branch also
--       covers Companies House company numbers, not just charity numbers — mapped to
--       exact_charity_number anyway since it's the closest fit and the enum has no
--       "exact_company_number" value. A real gap, flagged rather than silently
--       misnamed to look more precise.
--     - duplicate_group_id: null. Grouping three-or-more candidates pointing at the
--       same organisation is not built — this matcher flags one candidate at a time.
--     - llm_reasoning: null. No LLM is involved in this matcher.
--   match_fields IS populated (the legal_name/postcode actually compared) since that
--   much the matcher genuinely knows.
--
-- source_priority: this matcher isn't merging conflicting field values (that's F048),
--   but the column is NOT NULL, so every row needs a value. Set from the raw record's
--   own source, using the one source-priority rule already documented in this codebase
--   (docs/data-model/04-entities.md's legal_name note: "Companies House takes priority
--   over CharityBase"): companies_house = 1, charity_commission = 2 (lower = higher
--   priority, per this column's own field note in the Data Model).
--
-- match_status mapping: decide_duplicate_flag's two decisions are confirmed (this
--   candidate really is a duplicate) or dismissed (it isn't, the raw record should
--   become its own organisation). The Data Model's match_status enum is
--   pending/confirmed_match/confirmed_new/rejected. Mapped here as confirmed ->
--   confirmed_match, dismissed -> confirmed_new (the reviewer confirmed this is
--   genuinely a new/distinct organisation) — confirmed with Bashir in review, 9 Aug
--   2026, rather than guessed silently; "rejected" was the other candidate reading but
--   was agreed to mean something else (the candidate pairing itself was wrong, not
--   this matcher's current use).
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
-- THE 'confirmed_new' PATH:
--   Confirming a duplicate needs no further write — the candidate correctly never
--   became a second organisations row. Dismissing one is different: the raw record
--   really should become a new organisation, and the pipeline already knows how to do
--   that (promotePendingCharityCommissionRecords/promotePendingCompaniesHouseRecords)
--   — it just skipped this record on the run that flagged it. decide_duplicate_flag
--   resets that raw_source_records row to 'pending' with matched_organisation_id
--   cleared, so the next promote run picks it up. To stop it re-flagging against the
--   same organisation forever, match-organisations.ts's findDuplicateMatch takes an
--   excludeOrganisationIds set, and the promote loop populates it from every
--   'confirmed_new' decision already on file for that raw record (loadDismissedMatches).
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
--   Change        | Add rows to the existing ENTITY_MATCH_CANDIDATES table (Data
--                 | Model tab 03, added 23 Jul 2026) + decide_duplicate_flag RPC.
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
--   Documentation | Approved by Bashir (Project Leader), 7 Aug 2026 (original table);
--                 | table swapped to the existing ENTITY_MATCH_CANDIDATES and the
--                 | match_status/source_priority mapping confirmed with Bashir, 9 Aug
--                 | 2026. docs/rls-permission-matrix.md §3.15 updated alongside.
--
-- Reversibility: paired rollback in ../rollback/20260810120000_create_entity_match_candidates.down.sql

create table public.entity_match_candidates (
  id                          uuid primary key default gen_random_uuid(),
  raw_source_record_id        uuid not null references public.raw_source_records (id),
  candidate_organisation_id   uuid references public.organisations (id),
  match_score                 float not null check (match_score >= 0.0 and match_score <= 1.0),
  match_method                text not null
                                 check (match_method in ('exact_charity_number', 'fuzzy_name', 'address_match', 'manual')),
  match_fields                jsonb not null default '{}'::jsonb,
  llm_reasoning                text,
  duplicate_group_id          uuid,
  source_priority              int not null,
  match_status                text not null default 'pending'
                                 check (match_status in ('pending', 'confirmed_match', 'confirmed_new', 'rejected')),
  reviewed_by_user_id         uuid references public.users (id),
  reviewed_at                  timestamptz,
  notes                        text,
  created_at                  timestamptz not null default now(),

  -- Decision fields travel together, same reasoning as suppressions_decision_consistent.
  constraint entity_match_candidates_decision_consistent check (
    (match_status = 'pending' and reviewed_by_user_id is null and reviewed_at is null)
    or (match_status <> 'pending' and reviewed_by_user_id is not null and reviewed_at is not null)
  )
);

comment on table public.entity_match_candidates is
  'F042: a raw_source_records row the matching logic (src/lib/dedup/match-organisations.ts) '
  'thinks is the same charity as an existing organisations row. Written by the ingestion '
  'pipeline (service_role) when a match is found; decided by an admin via '
  'decide_duplicate_flag, which is the only write path for match_status/reviewed_by_user_id/'
  'reviewed_at. Reserved in the Data Model for a richer future matcher (LLM-assisted scoring, '
  'multi-candidate grouping) — see this migration''s header for which columns F042''s current '
  'binary matcher can and cannot honestly populate.';
comment on column public.entity_match_candidates.match_method is
  'How the pipeline found this pair: exact_charity_number (registration-number overlap — '
  'also used for Companies House company-number matches, see migration header), or '
  'fuzzy_name (normalised name + postcode). address_match and manual are reserved for a '
  'future matcher this table already anticipates; F042 never writes them.';
comment on column public.entity_match_candidates.match_score is
  'A placeholder confidence (1.0 for exact_charity_number, 0.7 for fuzzy_name), not a '
  'computed score — this matcher is binary. See migration header.';
comment on column public.entity_match_candidates.source_priority is
  'Which source wins if records conflict; lower = higher priority. companies_house = 1, '
  'charity_commission = 2, per docs/data-model/04-entities.md''s legal_name note.';

create unique index entity_match_candidates_raw_record_open_idx
  on public.entity_match_candidates (raw_source_record_id) where match_status = 'pending';
create index entity_match_candidates_candidate_org_idx
  on public.entity_match_candidates (candidate_organisation_id);
create index entity_match_candidates_pending_idx
  on public.entity_match_candidates (created_at) where match_status = 'pending';

-- Revoke before grant (MIGRATIONS.md RLS recipe step 1).
revoke all on public.entity_match_candidates from anon, authenticated;
grant select on public.entity_match_candidates to authenticated;
grant select, insert on public.entity_match_candidates to service_role;

alter table public.entity_match_candidates enable row level security;

-- Admin-only read: same reasoning as raw_source_records (§3.5) — reviewing a flag means
-- seeing the incoming raw payload via a join, which is not CAM-visible data.
create policy entity_match_candidates_select_admin on public.entity_match_candidates
  for select to authenticated
  using (app.is_admin() and app.is_active_user());

-- No INSERT/UPDATE policy for authenticated: rows are written by the ingestion
-- pipeline (service_role) and decided only through decide_duplicate_flag below.

-- ---------------------------------------------------------------------------
-- decide_duplicate_flag — admin only
-- ---------------------------------------------------------------------------

create or replace function public.decide_duplicate_flag(
  p_entity_match_candidate_id uuid,
  p_confirmed                 boolean,
  p_note                      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor            uuid := (select auth.uid());
  v_raw_record_id     uuid;
  v_candidate_org_id  uuid;
  v_status            text;
  v_new_status        text;
begin
  if not app.is_admin() then
    raise exception 'only an admin may decide an entity match candidate'
      using errcode = '42501';
  end if;

  select raw_source_record_id, candidate_organisation_id, match_status
    into v_raw_record_id, v_candidate_org_id, v_status
    from public.entity_match_candidates
   where id = p_entity_match_candidate_id;

  if v_raw_record_id is null then
    raise exception 'entity match candidate % not found', p_entity_match_candidate_id
      using errcode = 'P0002';
  end if;

  if v_status <> 'pending' then
    raise exception 'entity match candidate % is not pending', p_entity_match_candidate_id
      using errcode = '55000';
  end if;

  -- confirmed: this candidate really is a duplicate. dismissed: the reviewer confirms
  -- it is a genuinely new/distinct organisation (see migration header for why this
  -- maps to confirmed_new, not rejected).
  v_new_status := case when p_confirmed then 'confirmed_match' else 'confirmed_new' end;

  update public.entity_match_candidates
     set match_status = v_new_status,
         reviewed_by_user_id = v_actor,
         reviewed_at = now(),
         notes = p_note
   where id = p_entity_match_candidate_id;

  -- Dismissed as not-a-duplicate: the raw record should still become its own
  -- organisation. Reset it to 'pending' so the next promote run tries again — the
  -- pipeline excludes this specific (raw record, organisation) pair on retry by
  -- reading every 'confirmed_new' decision on file for that raw record (see
  -- match-organisations.ts / loadDismissedMatches), so it will not re-flag against
  -- the same organisation.
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
    'organisations', v_candidate_org_id,
    jsonb_build_object(
      'entity_match_candidate_id', p_entity_match_candidate_id,
      'raw_source_record_id', v_raw_record_id,
      'note', p_note
    )
  );
end;
$$;

comment on function public.decide_duplicate_flag(uuid, boolean, text) is
  'F042: admin confirms or dismisses a flagged entity match candidate. SECURITY DEFINER; '
  'self-checks app.is_admin(), rejects a non-pending target, resets the raw record to '
  'pending on dismissal so it gets promoted normally, writes audit_log in the same '
  'transaction.';

revoke execute on function public.decide_duplicate_flag(uuid, boolean, text) from public;
revoke execute on function public.decide_duplicate_flag(uuid, boolean, text) from anon;
grant execute on function public.decide_duplicate_flag(uuid, boolean, text) to authenticated;
