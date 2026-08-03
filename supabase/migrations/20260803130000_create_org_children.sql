-- Migration: create_org_children
-- Sequence step 4.0 (Data Model tab 11). Runs after create_organisations (3.0) and
--   create_rls_helpers (3a) — every table here FKs to ORGANISATIONS, and the notes
--   policies are the first consumers of app.can_write().
-- Stories: F067 Client Detail Page, F072/F073/F074 Notes, F075 Communication Timeline,
--   F159 Contact Log. Built now for F257: AC4 requires that notes and client context
--   stay attached to the client through a handover, and that cannot be demonstrated —
--   or falsified — while the tables do not exist.
-- Spec: docs/rls-permission-matrix.md §3.2 (canonical data), §3.3 (notes)
--
-- WHY THESE SIX TOGETHER:
--   Tab 11 defines step 4.0 as one migration. Splitting it to land NOTES alone (the
--   only table F257 strictly needs) would put the repo out of step with the Data Model
--   sequence for no gain — the other five are the same shape, the same FK, and the same
--   two policy patterns.
--
-- THE POINT F257 CARES ABOUT:
--   Not one of these tables has an owner column. They hang off organisation_id, so a
--   change of owner moves them implicitly and reassign_ownership does not name them at
--   all. That is the design AC4 rests on, and it is now testable rather than argued.
--
-- Schema change approval record (SOP §7):
--   Change        | Add ORGANISATION_IDENTIFIERS, CONTACTS, FINANCIAL_PERIODS, GRANTS,
--                 | ENRICHMENT_RESULTS, NOTES + 4 enums (sequence step 4.0)
--   Reason        | Client detail, notes and timeline stories; F257 AC4 verification.
--   Compatibility | New tables. Nothing existing reads or writes them.
--   Data migration| None.
--   Security      | RLS on for all six, policies in this migration (SOP §7). Canonical
--                 | data is admin-write (§3.2); notes are author-write (§3.3);
--                 | enrichment is service-role-write only.
--   Documentation | Already in Data Model tabs 02 and 04; no spreadsheet change needed.
--                 | Approved by Bashir (Project Leader), 3 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260803130000_create_org_children.down.sql

-- Enum values are exactly those in Data Model tab 04. A committed enum value cannot be
-- dropped in Postgres, so extending any of these needs the Wednesday-call agreement
-- SOP §7 requires — same one-way door as organisation_type and action_status.
create type public.identifier_type as enum (
  'uk_charity', 'uk_company', 'eu_company', 'international_registry', 'website', 'manual'
);
create type public.contact_source as enum ('api', 'manual', 'enrichment');
create type public.income_band as enum ('under_10k', '10k_100k', '100k_1m', 'over_1m');
create type public.financial_source as enum ('charitybase', 'charity_commission');


-- ---------------------------------------------------------------------------
-- ORGANISATION_IDENTIFIERS — registry numbers, one of them primary
-- ---------------------------------------------------------------------------
create table public.organisation_identifiers (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  identifier_type     public.identifier_type not null,
  identifier_value    text not null,
  registry_name       text,
  registry_country    text,
  is_primary          boolean not null default false,
  verified            boolean not null default false,
  -- SET NULL, not CASCADE: who verified a registry number is a fact about the record,
  -- and it must not disappear with the account. Same reasoning as audit_log.actor.
  verified_by_user_id uuid references public.users (id) on delete set null,
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),

  -- Tab 04: "Null until verified". Keeping the flag and the timestamp in step stops a
  -- row claiming verification with no record of when.
  constraint organisation_identifiers_verified_at_matches
    check (verified = (verified_at is not null))
);

comment on table public.organisation_identifiers is
  'Registry identifiers for an organisation (Data Model tab 04). Deduplication keys on '
  'the primary one.';

-- Tab 04: "Only one per organisation can be true". A partial unique index is the way to
-- say that — a plain unique would allow exactly one *false* row per organisation too.
create unique index organisation_identifiers_one_primary_idx
  on public.organisation_identifiers (organisation_id) where is_primary;
create index organisation_identifiers_organisation_idx
  on public.organisation_identifiers (organisation_id);
-- Deduplication looks a value up across organisations, not within one.
create index organisation_identifiers_value_idx
  on public.organisation_identifiers (identifier_type, identifier_value);


-- ---------------------------------------------------------------------------
-- CONTACTS — the people outreach is addressed to
-- ---------------------------------------------------------------------------
create table public.contacts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  first_name      text,
  last_name       text,
  email           text,
  phone           text,
  job_title       text,
  is_primary      boolean not null default false,
  contact_source  public.contact_source,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.contacts is
  'People at an organisation (Data Model tab 04). Every name/email column is nullable: '
  'these arrive from third-party APIs and enrichment, which routinely return partial '
  'records, and a NOT NULL here would drop an otherwise usable contact.';

create index contacts_organisation_idx on public.contacts (organisation_id);
-- Tab 04 does not state a one-primary rule for contacts as it does for identifiers, so
-- none is enforced. Raise it on the Wednesday call if the UI comes to depend on it.
create index contacts_email_idx on public.contacts (email) where email is not null;

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- FINANCIAL_PERIODS — filed accounts, one row per period
-- ---------------------------------------------------------------------------
create table public.financial_periods (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  period_start      date not null,
  period_end        date not null,
  total_income      numeric,
  total_expenditure numeric,
  income_band       public.income_band,
  filing_date       date,
  financial_source  public.financial_source not null,
  created_at        timestamptz not null default now(),

  constraint financial_periods_period_ordered check (period_end >= period_start)
);

comment on table public.financial_periods is
  'Filed accounts per financial period (Data Model tab 04). income_band is computed '
  'from total_income on ingestion, not entered.';

create index financial_periods_organisation_idx
  on public.financial_periods (organisation_id, period_end desc);

-- Re-running an ingestion must not double a filing. The same organisation cannot have
-- two records of the same period from the same source.
create unique index financial_periods_unique_period_idx
  on public.financial_periods (organisation_id, period_start, period_end, financial_source);


-- ---------------------------------------------------------------------------
-- GRANTS — 360Giving awards
-- ---------------------------------------------------------------------------
create table public.grants (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  grant_id        text not null,
  funder_name     text not null,
  amount_awarded  numeric,
  currency        text not null default 'GBP',
  award_date      date,
  grant_programme text,
  description     text,
  created_at      timestamptz not null default now()
);

comment on table public.grants is
  'Grant awards from 360Giving (Data Model tab 04). grant_id is 360Giving''s own '
  'identifier, not ours.';
comment on column public.grants.grant_id is
  'The 360Giving award id. Unique per organisation so a repeated ingestion updates '
  'rather than duplicates — it is not a primary key here because the same award can be '
  'restated against a re-matched organisation.';

create index grants_organisation_idx on public.grants (organisation_id, award_date desc);
create unique index grants_unique_award_idx on public.grants (organisation_id, grant_id);


-- ---------------------------------------------------------------------------
-- ENRICHMENT_RESULTS — LLM and API-derived profile data
-- ---------------------------------------------------------------------------
create table public.enrichment_results (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  mission_statement    text,
  mission_keywords     text[],
  news_hooks           text[],
  sector               text,
  sub_sector           text,
  website_url          text,
  email_validity_score numeric,
  social_links         jsonb,
  confidence_score     numeric,
  needs_review         boolean not null default false,
  enriched_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),

  -- Tab 04 documents both as 0.0-1.0.
  constraint enrichment_results_email_score_range
    check (email_validity_score is null
           or (email_validity_score >= 0 and email_validity_score <= 1)),
  constraint enrichment_results_confidence_range
    check (confidence_score is null
           or (confidence_score >= 0 and confidence_score <= 1))
);

comment on table public.enrichment_results is
  'LLM and API-derived organisation profile (Data Model tab 04). Written only by the '
  'enrichment worker through service_role — no end-user role holds INSERT or UPDATE.';
comment on column public.enrichment_results.enriched_at is
  'When enrichment last ran. Tab 04 does not say whether history is retained, so no '
  'uniqueness is enforced per organisation and repeated runs append. Settle on the '
  'Wednesday call before anything reads "the" enrichment row.';

create index enrichment_results_organisation_idx
  on public.enrichment_results (organisation_id, enriched_at desc);
create index enrichment_results_needs_review_idx
  on public.enrichment_results (needs_review) where needs_review;


-- ---------------------------------------------------------------------------
-- NOTES — the CAM's own record, and the reason F257 needed step 4.0
-- ---------------------------------------------------------------------------
create table public.notes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  -- SET NULL, and therefore nullable, though tab 04 marks it No: a note must outlive
  -- the account that wrote it. Deleting a departed CAM's user row cannot be allowed to
  -- delete the client history they built — that is the F257 loss in another form.
  -- DEVIATION FROM TAB 04, NOT YET MIRRORED: the spreadsheet marks author_id
  -- Nullable = No. It needs changing to Yes with the note above; until it is, the
  -- Data Model and this table disagree. Flagged to the Project Leader 3 Aug 2026.
  author_id       uuid references public.users (id) on delete set null,
  content         text not null,
  created_at      timestamptz not null default now(),
  -- Tab 04: "Null if never edited", so no default.
  updated_at      timestamptz,

  constraint notes_content_not_blank check (length(trim(content)) > 0)
);

comment on table public.notes is
  'CAM notes against a client (F072-F074). Hangs off organisation_id and carries no '
  'owner column, so a handover moves it implicitly — this is what F257 AC4 rests on.';
comment on column public.notes.author_id is
  'Who wrote it. Never rewritten by a reassignment: authorship is history, and the '
  'timeline reads "written by [former CAM]" after a handover (matrix §3.11).';

create index notes_organisation_idx on public.notes (organisation_id, created_at desc);
create index notes_author_idx on public.notes (author_id);

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- Security. REVOKE before GRANT on every table (matrix §2.1) — Supabase default-grants
-- all privileges on new public tables to anon and authenticated, so the policies below
-- would otherwise sit on top of full access. anon gets nothing, anywhere.
-- ---------------------------------------------------------------------------
revoke all on public.organisation_identifiers from anon, authenticated;
revoke all on public.contacts               from anon, authenticated;
revoke all on public.financial_periods      from anon, authenticated;
revoke all on public.grants                 from anon, authenticated;
revoke all on public.enrichment_results     from anon, authenticated;
revoke all on public.notes                  from anon, authenticated;

alter table public.organisation_identifiers enable row level security;
alter table public.contacts                 enable row level security;
alter table public.financial_periods        enable row level security;
alter table public.grants                   enable row level security;
alter table public.enrichment_results       enable row level security;
alter table public.notes                    enable row level security;

-- Every table here is readable by every active user. That is F019 (shared client
-- visibility) and it is also what makes a handover work: the incoming CAM must be able
-- to read the client's history, and the outgoing CAM's notes are most of it.
grant select on public.organisation_identifiers to authenticated;
grant select on public.contacts               to authenticated;
grant select on public.financial_periods      to authenticated;
grant select on public.grants                 to authenticated;
grant select on public.enrichment_results     to authenticated;
grant select on public.notes                  to authenticated;

create policy organisation_identifiers_select_active on public.organisation_identifiers
  for select to authenticated using (app.is_active_user());
create policy contacts_select_active on public.contacts
  for select to authenticated using (app.is_active_user());
create policy financial_periods_select_active on public.financial_periods
  for select to authenticated using (app.is_active_user());
create policy grants_select_active on public.grants
  for select to authenticated using (app.is_active_user());
create policy enrichment_results_select_active on public.enrichment_results
  for select to authenticated using (app.is_active_user());
create policy notes_select_active on public.notes
  for select to authenticated using (app.is_active_user());

-- Canonical registry, financial and grant data is admin-write (matrix §3.2). A CAM who
-- believes a filing is wrong goes through the suggestion flow (F077), not a direct
-- write — these rows are what the scoring model reads.
grant insert, update, delete on public.organisation_identifiers to authenticated;
grant insert, update, delete on public.financial_periods        to authenticated;
grant insert, update, delete on public.grants                   to authenticated;

create policy organisation_identifiers_write_admin on public.organisation_identifiers
  for all to authenticated
  using (app.is_active_user() and app.is_admin())
  with check (app.is_active_user() and app.is_admin());

create policy financial_periods_write_admin on public.financial_periods
  for all to authenticated
  using (app.is_active_user() and app.is_admin())
  with check (app.is_active_user() and app.is_admin());

create policy grants_write_admin on public.grants
  for all to authenticated
  using (app.is_active_user() and app.is_admin())
  with check (app.is_active_user() and app.is_admin());

-- CONTACTS is the exception in §3.2: admins and CAMs both write, because finding the
-- right person at a charity is the CAM's job. Deletion stays with admins.
grant insert, update, delete on public.contacts to authenticated;

create policy contacts_write_can_write on public.contacts
  for insert to authenticated
  with check (app.is_active_user() and app.can_write());

create policy contacts_update_can_write on public.contacts
  for update to authenticated
  using (app.is_active_user() and app.can_write())
  with check (app.is_active_user() and app.can_write());

create policy contacts_delete_admin on public.contacts
  for delete to authenticated
  using (app.is_active_user() and app.is_admin());

-- ENRICHMENT_RESULTS carries no write grant for any end-user role (§3.2: service role
-- only). The enrichment worker holds the service key and bypasses RLS; an admin may
-- delete a bad run, which is the one human write the matrix allows.
grant delete on public.enrichment_results to authenticated;

create policy enrichment_results_delete_admin on public.enrichment_results
  for delete to authenticated
  using (app.is_active_user() and app.is_admin());

-- NOTES (matrix §3.3): every CAM writes notes on any client — F019 makes the record
-- shared, and a CAM covering for someone must be able to add to it. Editing and
-- deleting stay with the author, or an admin.
grant insert, update, delete on public.notes to authenticated;

create policy notes_insert_author on public.notes
  for insert to authenticated
  with check (app.is_active_user() and app.can_write() and author_id = auth.uid());

-- coalesce(..., false) is load-bearing exactly as on organisations and actions:
-- author_id is nullable (the author's account may have been deleted), and
-- `null = auth.uid()` is NULL, which a WITH CHECK treats as a pass. Without it, every
-- CAM could edit every orphaned note.
create policy notes_update_own on public.notes
  for update to authenticated
  using (app.is_active_user()
         and (app.is_admin() or coalesce(author_id = auth.uid(), false)))
  with check (app.is_active_user()
              and (app.is_admin() or coalesce(author_id = auth.uid(), false)));

create policy notes_delete_own on public.notes
  for delete to authenticated
  using (app.is_active_user()
         and (app.is_admin() or coalesce(author_id = auth.uid(), false)));
