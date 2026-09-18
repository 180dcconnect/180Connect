-- Migration: website_absent_flag
-- Sequence: addition (after apply_admin_field_edits; needs public.organisations,
--   public.users, app.is_admin and public.audit_log). Not a numbered step — a
--   column addition with its write RPC, following close_admin_owner_id_direct_write.
-- Story: Incomplete records — "this client has no website" (Bashir, 17 Sep 2026).
-- Spec: docs/rls-permission-matrix.md §3.2, docs/audit-log-pattern.md
--
-- WHY:
--   The incomplete-records queue reads an empty ORGANISATIONS.website as a gap to
--   close, and for some clients there is no gap to close: they simply have no
--   website. Until now the only two answers on that screen were "leave the card on
--   the queue forever" and "type something untrue into the column".
--
--   This adds the third answer: an explicit, attributed mark meaning "we looked;
--   there is none". The record stops counting as incomplete for the website and
--   drops out of the Website tab, while the column stays genuinely empty — which
--   is what the "Check the source" links and the enrichment pipeline depend on.
--
-- WHAT:
--   1. website_absent_at / website_absent_by on organisations: when the mark was
--      made and by whom, in the pair shape organisation_identifiers already uses
--      for its verified audit trail.
--   2. A BEFORE INSERT OR UPDATE trigger that clears both the moment the record
--      holds a website. A website on file always wins: the mark only exists to
--      explain an empty column, so it cannot outlive one. That is also what makes
--      the mark undoable by the ordinary act of adding a website, from this screen,
--      the client profile, an approved suggestion, or the pipeline itself.
--   3. set_website_absent(organisation_id, absent) — the only way to set or clear
--      the mark. SECURITY DEFINER, re-checks app.is_admin() itself, and writes one
--      audit_log row in the same transaction.
--
-- WHO:
--   Admins today (decision of 17 Sep 2026). A CAM's route is the suggestion queue —
--   propose "this client has no website", an admin confirms it — which lands as a
--   later migration extending edit_suggestions and decide_edit_suggestion.
--
-- SECURITY:
--   The two columns are deliberately absent from the authenticated UPDATE column
--   list (20260810110000_close_admin_owner_id_direct_write), so a hand-crafted
--   PostgREST PATCH cannot touch them: the RPC is the only door, and it audits. No
--   new table, no policy change, no grant widened.
--
-- Schema change approval record (SOP §7):
--   Change        | 2 columns, 1 check constraint, 1 trigger + function and 1 RPC on
--                 | public.organisations. No table, policy or grant changes.
--   Reason        | Some clients have no website; the queue has to be told so.
--   Compatibility | Additive. Every existing read of organisations is unaffected;
--                 | null means "not marked", which is true of every existing row.
--   Data migration| None — nothing to backfill.
--   Security      | No privilege widened. The RPC self-checks app.is_admin() and its
--                 | EXECUTE is revoked from public/anon, granted to authenticated.
--   Documentation | docs/data-model regenerated with `npm run export:data-model`
--                 | once the Data Model spreadsheet carries the two columns (SOP §7
--                 | puts the spreadsheet first — called out in the PR).
--
-- Reversibility: paired rollback in ../rollback/20261018090000_website_absent_flag.down.sql

alter table public.organisations
  add column website_absent_at timestamptz,
  add column website_absent_by uuid references public.users (id) on delete set null;

-- Either both halves of the mark are set or neither is: a timestamp with nobody
-- attached (or a name with no date) would be a claim the audit trail cannot back.
alter table public.organisations
  add constraint organisations_website_absent_pair
  check ((website_absent_at is null) = (website_absent_by is null));

comment on column public.organisations.website_absent_at is
  'When someone confirmed this client has no website (null = not confirmed). Set and '
  'cleared only by set_website_absent; cleared automatically when a website is on file.';
comment on column public.organisations.website_absent_by is
  'The admin who recorded that this client has no website, set with website_absent_at. '
  'Read by the incomplete-records queue; the readable history is the audit_log rows.';

-- ---------------------------------------------------------------------------
-- A website on file always wins
-- ---------------------------------------------------------------------------

create or replace function public.clear_website_absent_when_website_set()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The mark answers "why is this column empty?". Once it is not empty the
  -- question is gone, and a record holding both a website and "no website" reads
  -- as a contradiction on every screen that shows either.
  if nullif(btrim(new.website), '') is not null then
    new.website_absent_at := null;
    new.website_absent_by := null;
  end if;

  return new;
end;
$$;

comment on function public.clear_website_absent_when_website_set() is
  'Clears website_absent_at/by whenever organisations.website holds a value, for '
  'every writer: the flag explains an empty column and cannot outlive one.';

create trigger organisations_clear_website_absent
  before insert or update on public.organisations
  for each row execute function public.clear_website_absent_when_website_set();

-- ---------------------------------------------------------------------------
-- The write path
-- ---------------------------------------------------------------------------

create or replace function public.set_website_absent(
  p_organisation_id uuid,
  p_absent          boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_website    text;
  v_was_absent boolean;
begin
  -- Authorisation, re-checked inside the definer boundary: the columns are not in
  -- the authenticated UPDATE grant, so this is the only writer and it must say who.
  if not app.is_admin() then
    raise exception 'only an admin can record that a client has no website'
      using errcode = '42501';
  end if;

  select nullif(btrim(website), ''), (website_absent_at is not null)
    into v_website, v_was_absent
    from public.organisations
   where id = p_organisation_id;

  if not found then
    raise exception 'client % not found', p_organisation_id
      using errcode = 'P0002';
  end if;

  -- No-op changes are not audited — the trail records real transitions only.
  if v_was_absent = p_absent then
    return;
  end if;

  -- Marking "no website" while one is on file would leave a record that reads both
  -- ways. The screen only offers the mark when the column is empty; this is the
  -- check underneath it.
  if p_absent and v_website is not null then
    raise exception 'client % already has a website on file', p_organisation_id
      using errcode = '23514';
  end if;

  update public.organisations
     set website_absent_at = case when p_absent then now() else null end,
         website_absent_by = case when p_absent then v_actor else null end
   where id = p_organisation_id;

  -- Same transaction as the write, so the two cannot diverge (F221, pattern §1).
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_absent then 'website_marked_absent' else 'website_absent_cleared' end,
    'organisations',
    p_organisation_id,
    jsonb_build_object('no_website', p_absent)
  );
end;
$$;

comment on function public.set_website_absent(uuid, boolean) is
  'Records (or retracts) the claim that a client has no website, so the '
  'incomplete-records queue stops counting the empty website column as a gap. '
  'Admin-only: self-checks app.is_admin() inside SECURITY DEFINER because the '
  'columns are not in the authenticated UPDATE column grant. Audits both '
  'directions; a website on file is refused (23514) and clears the mark itself.';

-- anon can never call it; authenticated can, and the body rejects non-admins.
-- Revoke from public AND anon explicitly: EXECUTE defaults to public on create.
revoke execute on function public.set_website_absent(uuid, boolean) from public;
revoke execute on function public.set_website_absent(uuid, boolean) from anon;
grant execute on function public.set_website_absent(uuid, boolean) to authenticated;
