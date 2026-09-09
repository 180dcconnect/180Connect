-- Why a correction was proposed, from the CAM who proposed it.
--
-- EDIT_SUGGESTIONS has carried `rejection_reason` since 20260822140000 — the
-- admin's note *back*. There has never been a note *forward*. The admin
-- deciding a suggestion sees only `current_value → proposed_value`, which for
-- an identity field is frequently indistinguishable from a typo: "St Mary's
-- Trust" → "St Marys Trust" is either a correction against Companies House or
-- a slip, and nothing on the row says which. The decision is then a guess, and
-- a guessed approval writes a wrong value onto a record other systems dedupe
-- against.
--
-- Optional, deliberately. Most corrections are self-evident (a dead domain, a
-- bounced address) and forcing a sentence out of a CAM for those trains people
-- to type "wrong" into the box. Capped at 280 characters: enough for the source
-- of the correction, short enough that an admin reads it rather than skims it.
--
-- No RLS work: this adds a column to an existing table whose policies are
-- row-scoped (20260822140000), so the new column inherits them. No audit_log
-- entry either — submitting a suggestion is not a decision, and the RPC's
-- header records why the whole submission path stays out of the audit trail.

-- IF NOT EXISTS: staging already carries this column (with the same shape
-- constraint) from untracked applies of branch work — same story as
-- 20260923114000's recorded_by guard. From scratch this is a plain add.
alter table public.edit_suggestions
  add column if not exists reason text
    constraint edit_suggestions_reason_shape
      check (reason is null or (btrim(reason) <> '' and char_length(reason) <= 280));

comment on column public.edit_suggestions.reason is
  'Optional note from the requester saying why the correction is right (e.g. the '
  'register it was checked against). Null when none was given; never blank. The '
  'admin''s note back is rejection_reason.';

-- ---------------------------------------------------------------------------
-- suggest_organisation_edit — the reason-carrying signature.
-- ---------------------------------------------------------------------------
-- Added as a four-argument overload rather than a replacement. The three-arg
-- form is referenced by name and signature elsewhere (supabase/tests/
-- rls_policies.test.sql checks `to_regprocedure` on it), and PostgREST resolves
-- an RPC by the keys in the body, so both doors stay open and both end up in
-- the same body below.

create or replace function public.suggest_organisation_edit(
  p_organisation_id uuid,
  p_field_name      text,
  p_new_value       text,
  p_reason          text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := (select auth.uid());
  v_field     text := btrim(coalesce(p_field_name, ''));
  v_new_value text := coalesce(p_new_value, '');
  -- Blank and whitespace-only collapse to null, so the check constraint above
  -- never sees an empty string and the UI can send the textarea's raw value.
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_exists    boolean;
  v_current   text;
  v_pending   public.edit_suggestions%rowtype;
  v_id        uuid;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_cam() then
    raise exception 'only a CAM can suggest an edit'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.restricted_edit_fields
     where field_name = v_field
       and active
  ) then
    raise exception 'this field does not accept suggested edits'
      using errcode = '23514';
  end if;

  if btrim(v_new_value) = '' then
    raise exception 'enter the corrected value — suggestions cannot clear a field'
      using errcode = '23514';
  end if;

  -- Bound here as well as in the constraint: a constraint violation surfaces as
  -- a 23514 with Postgres's own wording, which is not something to show a CAM.
  if char_length(v_reason) > 280 then
    raise exception 'keep the note to 280 characters or fewer'
      using errcode = '23514';
  end if;

  select exists (select 1 from public.organisations where id = p_organisation_id)
    into v_exists;

  if not v_exists then
    raise exception 'client % not found', p_organisation_id
      using errcode = 'P0002';
  end if;

  select to_jsonb(o) ->> v_field
    into v_current
    from public.organisations o
   where o.id = p_organisation_id;

  if btrim(v_new_value) = btrim(coalesce(v_current, '')) then
    raise exception 'that is already the value on record'
      using errcode = '55000';
  end if;

  select * into v_pending
    from public.edit_suggestions
   where organisation_id = p_organisation_id
     and field_name = v_field
     and status = 'pending';

  if v_pending.id is not null then
    if v_pending.requested_by <> v_actor then
      raise exception 'another team member already has a pending suggestion for this field'
        using errcode = '23505';
    end if;
    update public.edit_suggestions
       set status = 'superseded',
           updated_at = now()
     where id = v_pending.id;
  end if;

  insert into public.edit_suggestions
    (organisation_id, field_name, current_value, proposed_value, requested_by, reason)
  values
    (p_organisation_id, v_field, v_current, btrim(v_new_value), v_actor, v_reason)
  returning id into v_id;

  if v_pending.id is not null then
    update public.edit_suggestions
       set superseded_by = v_id
     where id = v_pending.id;
  end if;

  return v_id;
end;
$$;

comment on function public.suggest_organisation_edit(uuid, text, text, text) is
  '#79 (F077) / F020, plus the requester''s optional note. Identical guards to the '
  'three-argument form, which now delegates here: allowlist from '
  'restricted_edit_fields, server-side current_value snapshot, supersedes the '
  'caller''s own pending suggestion, refuses while another CAM''s is pending, refuses '
  'a no-op. Writes nothing to organisations and no audit_log row. SECURITY DEFINER; '
  'self-checks app.is_cam().';

revoke all on function public.suggest_organisation_edit(uuid, text, text, text) from public;
grant execute on function public.suggest_organisation_edit(uuid, text, text, text) to authenticated;

-- The original signature, now a wrapper. Kept so existing callers and the pgTAP
-- suite's signature probe keep working without a second body to maintain.
create or replace function public.suggest_organisation_edit(
  p_organisation_id uuid,
  p_field_name      text,
  p_new_value       text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.suggest_organisation_edit(
    p_organisation_id,
    p_field_name,
    p_new_value,
    null::text
  );
$$;

comment on function public.suggest_organisation_edit(uuid, text, text) is
  'Reason-less shorthand for public.suggest_organisation_edit(uuid, text, text, text). '
  'Delegates to it, so every guard lives in exactly one body.';

revoke all on function public.suggest_organisation_edit(uuid, text, text) from public;
grant execute on function public.suggest_organisation_edit(uuid, text, text) to authenticated;
