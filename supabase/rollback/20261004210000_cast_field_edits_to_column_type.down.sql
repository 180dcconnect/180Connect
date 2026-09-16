-- Rollback of 20261004210000_cast_field_edits_to_column_type.
--
-- Restores both functions to the bodies 20260923114000 wrote — the ones that
-- bound the value as a bare `$1`, letting Postgres infer text.
--
-- Read this before running it. The migration being reverted is a bug fix, and
-- this file puts the bug back:
--   * every edit to an enum column (geographic_reach, organisation_type) fails
--     with 42804 ("column ... is of type public.geographic_reach but expression
--     is of type text");
--   * because the RPCs apply all-or-nothing, one such edit takes the rest of the
--     batch down with it;
--   * a suggested edit on organisation_type can never be approved.
-- Only roll back if the app code is going back with it, or if the fix itself is
-- what is being withdrawn. Re-applying 20261004210000 is the way forward.

-- 1. Admin direct field edits: back to the uncast dynamic apply-back.
create or replace function public.apply_admin_field_edits(
  p_organisation_id uuid,
  p_changes         jsonb,   -- [{field_name, value}] — every element applied
  p_reason          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_change      jsonb;
  v_field       text;
  v_value       text;
  v_valid       boolean;
  v_results     jsonb := '[]'::jsonb;
  v_applied     int  := 0;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active' using errcode = '42501';
  end if;
  if not app.is_admin() then
    raise exception 'only an admin can edit directly' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'nothing has been changed yet' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organisations where id = p_organisation_id
  ) then
    raise exception 'organisation not found' using errcode = 'P0002';
  end if;

  -- Pre-flight over every element: one bad change fails the whole batch before
  -- any column is touched, so the record is never briefly half-corrected.
  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_field := v_change->>'field_name';
    if v_field not in
      ('legal_name', 'organisation_type', 'city', 'address_line_1', 'postcode',
       'country_code', 'contact_email', 'website', 'sector', 'sub_sector',
       'geographic_reach')
    then
      raise exception '% cannot be edited here', v_field using errcode = '55000';
    end if;
    if nullif(btrim(coalesce(v_change->>'value', '')), '') is null then
      raise exception 'a change is missing its value' using errcode = '22023';
    end if;
  end loop;

  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_field := v_change->>'field_name';
    v_value := btrim(v_change->>'value');

    -- Provenance covers exactly the tracked fields. Other admin-writable
    -- columns still get written; they just have no field history yet — the
    -- honest state, not a fake row.
    v_valid := v_field in
      ('legal_name', 'website', 'contact_email', 'address_line_1', 'city',
       'postcode', 'organisation_type');

    if v_valid then
      perform public.record_field_source(
        p_organisation_id, v_field, v_value, 'manual', null, v_actor
      );
    end if;

    -- Guarded dynamic apply-back, same three guards as decide_edit_suggestion's
    -- (20260822160200): FK-shaped identifier comes from this fixed allowlist,
    -- existence check, %-quoted identifier with a parameterised value.
    -- 'organisation_type' is a Postgres enum column, which is why the update is
    -- dynamic rather than a case list.
    if not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'organisations'
         and column_name  = v_field
    ) then
      raise exception 'restricted field % no longer exists on the client record', v_field
        using errcode = '55000';
    end if;

    execute format(
      'update public.organisations set %I = $1 where id = $2',
      v_field
    ) using v_value, p_organisation_id;

    v_applied := v_applied + 1;
    v_results := v_results || jsonb_build_object('field_name', v_field, 'ok', true);
  end loop;

  -- One audit row per submission, not per field (audit-log-pattern §3: the
  -- trail records real transitions; set_user_role set the no-noise convention).
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    'fields_direct_edited',
    'organisations', p_organisation_id,
    jsonb_build_object(
      'changes',        p_changes,
      'reason',         nullif(btrim(coalesce(p_reason, '')), ''),
      'applied_count',  v_applied
    )
  );

  return v_results;
end;
$$;

comment on function public.apply_admin_field_edits(uuid, jsonb, text) is
  'Admin direct field edits, attributed (20260923114000): applies each {field_name, '
  'value} change onto organisations, records FIELD_SOURCES provenance (source=''manual'', '
  'recorded_by=the admin) for tracked fields, and writes one audit_log row '
  '(fields_direct_edited) — all in the caller''s transaction. SECURITY DEFINER; '
  'self-checks app.is_admin(). Replaces adminDirectEditsAction''s direct UPDATE. '
  'Value normalisation and enum checks stay in the action; the RPC accepts what '
  'the action validated.';

revoke execute on function public.apply_admin_field_edits(uuid, jsonb, text)
  from public, anon;
grant execute on function public.apply_admin_field_edits(uuid, jsonb, text)
  to authenticated;

-- 2. Approving a suggested edit: same, plus the stale-snapshot guard.
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

  -- p_reason is optional by design (F079 AC2 "allows the admin to LEAVE a reason"):
  -- blank strings are normalised to null so the column never carries whitespace
  -- masquerading as a reason.

  if p_approve then
    -- Stale-snapshot guard: read what the column says NOW, inside the same
    -- transaction that will write it.
    select to_jsonb(o) ->> v_suggestion.field_name
      into v_live_value
      from public.organisations o
     where o.id = v_suggestion.organisation_id;

    if v_live_value is distinct from v_suggestion.current_value then
      raise exception 'the live value changed since this was suggested — review the client and decide again'
        using errcode = '55000';
    end if;

    -- Guarded dynamic apply-back (see header): FK-validated identifier, existence
    -- check, %-quoted identifier, parameterised values. The organisations
    -- updated_at trigger fires as normal.
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

    -- F044 (20260923114000): the approval is a write to the field, so the field
    -- history says a person corrected it, not that the old register still owns
    -- the value. Provenance covers exactly the seven tracked fields; anything
    -- else (runtime-restricted columns such as trading_name) is written with no
    -- field history — the honest state, not an exception that would abort the
    -- whole approval. Same guard as apply_admin_field_edits above.
    if v_suggestion.field_name in
      ('legal_name', 'website', 'contact_email', 'address_line_1', 'city',
       'postcode', 'organisation_type')
    then
      perform public.record_field_source(
        v_suggestion.organisation_id,
        v_suggestion.field_name,
        v_suggestion.proposed_value,
        'manual',
        null,
        v_actor
      );
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
    case when p_approve
         then 'The correction to ' || v_suggestion.field_name || ' is now live on the client record.'
         else 'The proposed change to ' || v_suggestion.field_name || ' was reviewed and not applied.'
              || coalesce(' Reason: ' || v_reason, '')
    end,
    '/clients/' || v_suggestion.organisation_id,
    'organisations',
    v_suggestion.organisation_id,
    v_actor
  );
end;
$$;

comment on function public.decide_edit_suggestion(uuid, boolean, text) is
  '#80/#81 (F078/F079), rewritten by F020 (#23), re-rewritten 20260923114000: '
  'approval additionally records FIELD_SOURCES provenance (source=''manual'', '
  'recorded_by=the deciding admin) so the field history attributes the correction '
  'to a person. Everything else — guards, errcodes, audit, notification — '
  'unchanged from the F020 body.';
