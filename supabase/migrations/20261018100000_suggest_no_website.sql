-- Migration: suggest_no_website
-- Sequence: addition (after website_absent_flag and create_edit_suggestions;
--   needs public.edit_suggestions, public.set_website_absent, app.is_cam,
--   app.is_admin, public.audit_log). Complementary to website_absent_flag —
--   the two halves of "some clients have no website".
-- Story: Incomplete records — the CAM half of "this client has no website"
--   (Bashir, 17 Sep 2026).
-- Spec: docs/rls-permission-matrix.md §3.2, docs/audit-log-pattern.md
--
-- WHY:
--   20261018090000 gave an admin a way to record that a client has no website.
--   The people who actually notice it are the CAMs: they are the ones reading the
--   client's page, ringing round, and finding nothing. A CAM cannot write
--   organisations.website (the column-guard trigger refuses a non-admin write to a
--   restricted column), and until now the suggestion queue had no way to say "there
--   is nothing to put here" — only "replace this value with that one". So the CAM
--   either proposed something untrue or said nothing.
--
-- WHAT:
--   1. edit_suggestions.proposed_absent — a proposal that the record should carry
--      no website at all, rather than a replacement value. website-only (check
--      constraint), and it relaxes the "proposed_value is never blank" rule for
--      exactly those rows: there is no value to store, because the claim is that
--      there should not be one.
--   2. suggest_website_absent(organisation_id, reason) — the CAM's door. Same
--      guards as suggest_organisation_edit (active + app.is_cam, unknown client,
--      one live proposal per field: own supersedes, another CAM's blocks), plus two
--      this claim needs: refuse when a website is already on file (there is nothing
--      to propose) and refuse when the mark is already recorded (a no-op).
--   3. decide_edit_suggestion — approval of an absent proposal records the mark by
--      calling set_website_absent, the same RPC the admin's own screen calls. One
--      implementation of "mark it", so the two paths cannot drift; the staleness
--      guard already in the body covers this case for free, because the live
--      website must still be empty (current_value is null) for the proposal to
--      apply.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   No new audit action for the proposal itself — submitting a suggestion is not a
--   decision (20260822140000's header records why the submission path stays out of
--   the trail). The approval writes the usual edit_suggestion_approved row plus the
--   website_marked_absent row from set_website_absent, which is two facts about one
--   decision and both are true.
--
-- Schema change approval record (SOP §7):
--   Change        | 1 column + 2 constraints on edit_suggestions; 1 new RPC
--                 | (suggest_website_absent); replace body of decide_edit_suggestion
--                 | (signature, return type and grants unchanged).
--   Reason        | A CAM needs to report a client with no website without inventing
--                 | one; an admin confirms it in the queue they already work.
--   Compatibility | Additive. proposed_absent defaults false, so every existing row
--                 | and every existing suggestion path behaves exactly as before.
--   Data migration| None.
--   Security      | No privilege widened. The new RPC is CAM-only and self-checking;
--                 | the decide body keeps its admin check and its row lock. The
--                 | mark itself still moves only through set_website_absent.
--   Documentation | Data Model tabs 02/04 for the new column + tab 11 row; matrix
--                 | §3.2 note that the mark has a proposal route (pending PR).
--
-- Reversibility: paired rollback in ../rollback/20261018100000_suggest_no_website.down.sql

alter table public.edit_suggestions
  add column proposed_absent boolean not null default false;

comment on column public.edit_suggestions.proposed_absent is
  'True when the proposal is that the field should hold nothing at all (website '
  'only). proposed_value is empty on those rows by design — there is no value to '
  'apply, so approval records the "no website" mark instead of writing a column.';

-- The not-blank rule still holds for every ordinary proposal; an absent one has no
-- value to be blank.
alter table public.edit_suggestions
  drop constraint edit_suggestions_proposed_not_blank;

alter table public.edit_suggestions
  add constraint edit_suggestions_proposed_not_blank
    check (proposed_absent or btrim(proposed_value) <> '');

-- The mark only exists for the website. A "no value" proposal for a phone number
-- or an address has no meaning yet, and pretending it does would put a row in the
-- queue whose approval does nothing.
alter table public.edit_suggestions
  add constraint edit_suggestions_absent_is_website
    check (not proposed_absent or field_name = 'website');

-- ---------------------------------------------------------------------------
-- The CAM's door
-- ---------------------------------------------------------------------------

create or replace function public.suggest_website_absent(
  p_organisation_id uuid,
  p_reason          text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := (select auth.uid());
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_website text;
  v_absent  boolean;
  v_pending public.edit_suggestions%rowtype;
  v_id      uuid;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_cam() then
    raise exception 'only a CAM can suggest an edit'
      using errcode = '42501';
  end if;

  -- Bound here as well as in the constraint, so a CAM reads a sentence rather than
  -- Postgres's wording for a check violation.
  if char_length(v_reason) > 280 then
    raise exception 'keep the note to 280 characters or fewer'
      using errcode = '23514';
  end if;

  select nullif(btrim(website), ''), (website_absent_at is not null)
    into v_website, v_absent
    from public.organisations
   where id = p_organisation_id;

  if not found then
    raise exception 'client % not found', p_organisation_id
      using errcode = 'P0002';
  end if;

  if v_website is not null then
    raise exception 'this client already has a website on record'
      using errcode = '23514';
  end if;

  if v_absent then
    raise exception 'this client is already recorded as having no website'
      using errcode = '55000';
  end if;

  -- One live proposal per field (the same rule suggest_organisation_edit enforces):
  -- the caller's own is superseded; another CAM's blocks this one.
  select * into v_pending
    from public.edit_suggestions
   where organisation_id = p_organisation_id
     and field_name = 'website'
     and status = 'pending';

  if v_pending.id is not null then
    if v_pending.requested_by <> v_actor then
      raise exception 'another team member already has a pending suggestion for this field'
        using errcode = '23505';
    end if;
    -- Their own identical proposal is already waiting: nothing to add.
    if v_pending.proposed_absent then
      return v_pending.id;
    end if;
    update public.edit_suggestions
       set status = 'superseded',
           updated_at = now()
     where id = v_pending.id;
  end if;

  insert into public.edit_suggestions
    (organisation_id, field_name, current_value, proposed_value, proposed_absent,
     requested_by, reason)
  values
    (p_organisation_id, 'website', v_website, '', true, v_actor, v_reason)
  returning id into v_id;

  if v_pending.id is not null then
    update public.edit_suggestions
       set superseded_by = v_id
     where id = v_pending.id;
  end if;

  return v_id;
end;
$$;

comment on function public.suggest_website_absent(uuid, text) is
  '#23 / incomplete records: a CAM proposes that a client has no website at all, '
  'so an admin can stop the empty column counting as a gap. Refuses a client that '
  'has a website, or one already marked; supersedes the caller''s own pending '
  'website suggestion; writes nothing to organisations and no audit row — the '
  'decision does. SECURITY DEFINER; self-checks app.is_cam().';

revoke execute on function public.suggest_website_absent(uuid, text) from public;
revoke execute on function public.suggest_website_absent(uuid, text) from anon;
grant execute on function public.suggest_website_absent(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Deciding it
-- ---------------------------------------------------------------------------
--
-- Body for body the 20260822160200 function, plus the absent branch in the approve
-- path, the extra audit key and the notification copy. Everything the F078/F079
-- contract promises — admin-only, row lock, pending-only, the stale-snapshot guard,
-- rejection touching nothing, one audit row, the CAM told of the outcome — is
-- unchanged.

create or replace function public.decide_edit_suggestion(
  p_suggestion_id uuid,
  p_approve       boolean,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_suggestion  public.edit_suggestions%rowtype;
  v_live_value  text;
  v_reason      text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_admin() then
    raise exception 'only an admin may decide a suggested edit'
      using errcode = '42501';
  end if;

  select * into v_suggestion
    from public.edit_suggestions
   where id = p_suggestion_id
     for update;

  if v_suggestion.id is null then
    raise exception 'suggested edit % not found', p_suggestion_id
      using errcode = 'P0002';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'suggested edit % has already been decided', p_suggestion_id
      using errcode = '55000';
  end if;

  if p_approve then
    -- Stale-snapshot guard: read what the column says NOW, inside the same
    -- transaction that will write it. For an absent proposal this is the whole
    -- question — the column must still be empty for "there is no website" to be
    -- true, so a website that arrived in the meantime is caught here.
    select to_jsonb(o) ->> v_suggestion.field_name
      into v_live_value
      from public.organisations o
     where o.id = v_suggestion.organisation_id;

    if v_live_value is distinct from v_suggestion.current_value then
      raise exception 'the live value changed since this was suggested — review the client and decide again'
        using errcode = '55000';
    end if;

    if v_suggestion.proposed_absent then
      -- The claim is "no website", not "this value". Recording it goes through the
      -- same RPC the admin's own screen calls, so there is one implementation of
      -- the mark and one set of guards under it.
      perform public.set_website_absent(v_suggestion.organisation_id, true);
    else
      -- Guarded dynamic apply-back (see header of 20260822160200): FK-validated
      -- identifier, existence check, %-quoted identifier, parameterised values. The
      -- organisations updated_at trigger fires as normal.
      if not exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name   = 'organisations'
           and column_name  = v_suggestion.field_name
      ) then
        raise exception 'restricted field % no longer exists on the client record', v_suggestion.field_name
          using errcode = '55000';
      end if;

      execute format(
        'update public.organisations set %I = $1 where id = $2',
        v_suggestion.field_name
      ) using v_suggestion.proposed_value, v_suggestion.organisation_id;
    end if;
  end if;

  update public.edit_suggestions
     set status           = case when p_approve
                                then 'approved'::public.edit_suggestion_status
                                else 'rejected'::public.edit_suggestion_status end,
         decided_by       = v_actor,
         decided_at       = now(),
         rejection_reason = case when p_approve then null else v_reason end,
         updated_at       = now()
   where id = v_suggestion.id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_approve then 'edit_suggestion_approved' else 'edit_suggestion_rejected' end,
    'organisations', v_suggestion.organisation_id,
    jsonb_build_object(
      'suggestion_id', v_suggestion.id,
      'field',         v_suggestion.field_name,
      'from',          v_suggestion.current_value,
      'to',            case when p_approve then v_suggestion.proposed_value else null end,
      'no_website',    v_suggestion.proposed_absent,
      'requested_by',  v_suggestion.requested_by,
      'reason',        v_reason
    )
  );

  -- AC3: tell the submitting CAM which way it went. create_notification is also
  -- SECURITY DEFINER and self-checking; it silently skips a deactivated recipient.
  perform public.create_notification(
    v_suggestion.requested_by,
    'edit_suggestion_decided',
    case when p_approve
         then 'Your suggested edit was approved'
         else 'Your suggested edit was not applied' end,
    case
      when v_suggestion.proposed_absent then
        case when p_approve
             then 'This client is now recorded as having no website.'
             else 'The proposal to record this client as having no website was reviewed and not applied.'
                  || coalesce(' Reason: ' || v_reason, '')
        end
      else
        case when p_approve
             then 'The correction to ' || v_suggestion.field_name || ' is now live on the client record.'
             else 'The proposed change to ' || v_suggestion.field_name || ' was reviewed and not applied.'
                  || coalesce(' Reason: ' || v_reason, '')
        end
    end,
    '/clients/' || v_suggestion.organisation_id,
    'organisations',
    v_suggestion.organisation_id,
    v_actor
  );
end;
$$;

comment on function public.decide_edit_suggestion(uuid, boolean, text) is
  '#80/#81 (F078/F079), rewritten by F020 (#23) and extended for "no website" '
  'proposals: an admin approves or rejects a pending edit suggestion. Approval '
  're-checks the live value still matches the submission snapshot, then either '
  'applies proposed_value through a guarded dynamic identifier (%I, FK-validated '
  'against restricted_edit_fields, existence-checked) or — when the proposal is '
  'that the field should stay empty — records the website-absent mark through '
  'set_website_absent. Rejection touches nothing and records the optional reason. '
  'Both branches settle the row, write one audit_log row in-transaction, and notify '
  'the submitting CAM via create_notification (#23 AC3). SECURITY DEFINER; '
  'self-checks app.is_admin().';
