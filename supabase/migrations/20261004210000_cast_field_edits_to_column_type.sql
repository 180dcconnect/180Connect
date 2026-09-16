-- ---------------------------------------------------------------------------
-- Field edits must be cast to the column's own type, not left as text.
-- ---------------------------------------------------------------------------
--
-- Both dynamic apply-backs (20260923114000) bound the new value as a bare
-- parameter:
--
--     execute format('update public.organisations set %I = $1 where id = $2', ...)
--
-- `$1` is inferred as text, and Postgres will not assign text to an enum
-- column, so every edit to `geographic_reach` or `organisation_type` failed
-- with 42804 ("column ... is of type public.geographic_reach but expression is
-- of type text") — and because the RPC applies all-or-nothing, it took the rest
-- of the batch down with it. Text columns (sector, city, website …) were never
-- affected, which is why the bug only showed on the two enum fields.
--
-- The fix looks the column's type up in the catalog and casts to it. The
-- identifier still comes from the same fixed allowlist, the value is still a
-- parameter, and format_type() returns an already-quoted type name — so the
-- statement is no less guarded than before. The catalog lookup also replaces
-- the old information_schema existence check: a dropped column yields no row.
--
-- Membership in the enum is still checked by the caller (adminDirectEditsAction
-- and the panel's select); an out-of-set value now surfaces as 22P02 from the
-- cast rather than being silently accepted.

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
  v_type        text;
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

    -- FIELD_SOURCES covers exactly the tracked set; anything outside it is
    -- written with no field history rather than aborting the edit.
    v_valid := v_field in
      ('legal_name', 'website', 'contact_email', 'address_line_1', 'city',
       'postcode', 'organisation_type');

    if v_valid then
      perform public.record_field_source(
        p_organisation_id, v_field, v_value, 'manual', null, v_actor
      );
    end if;

    -- Guarded dynamic apply-back: identifier from the allowlist above, value
    -- parameterised, cast to the column's declared type (enum columns reject a
    -- text parameter outright).
    select pg_catalog.format_type(a.atttypid, a.atttypmod)
      into v_type
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.organisations'::regclass
       and a.attname  = v_field
       and a.attnum   > 0
       and not a.attisdropped;

    if v_type is null then
      raise exception 'restricted field % no longer exists on the client record', v_field
        using errcode = '55000';
    end if;

    execute format(
      'update public.organisations set %I = $1::%s where id = $2',
      v_field, v_type
    ) using v_value, p_organisation_id;

    v_applied := v_applied + 1;
    v_results := v_results || jsonb_build_object('field_name', v_field, 'ok', true);
  end loop;

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
  'Admin direct field edits, attributed (20260923114000; cast fix 20261004210000): '
  'applies each {field_name, value} change onto organisations — cast to the '
  'column''s declared type, so enum columns such as geographic_reach and '
  'organisation_type no longer fail with 42804 — records FIELD_SOURCES '
  'provenance (source=''manual'', recorded_by=the admin) for tracked fields, and '
  'writes one audit_log row (fields_direct_edited), all in the caller''s '
  'transaction. SECURITY DEFINER; self-checks app.is_admin().';

revoke execute on function public.apply_admin_field_edits(uuid, jsonb, text)
  from public, anon;
grant execute on function public.apply_admin_field_edits(uuid, jsonb, text)
  to authenticated;

-- The approval path has the same dynamic apply-back and the same bug: an
-- approved suggestion on organisation_type could never be written. Body is
-- 20260923114000's, with the cast.
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
  v_type        text;
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
    -- transaction that will write it.
    select to_jsonb(o) ->> v_suggestion.field_name
      into v_live_value
      from public.organisations o
     where o.id = v_suggestion.organisation_id;

    if v_live_value is distinct from v_suggestion.current_value then
      raise exception 'the live value changed since this was suggested — review the client and decide again'
        using errcode = '55000';
    end if;

    select pg_catalog.format_type(a.atttypid, a.atttypmod)
      into v_type
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.organisations'::regclass
       and a.attname  = v_suggestion.field_name
       and a.attnum   > 0
       and not a.attisdropped;

    if v_type is null then
      raise exception 'restricted field % no longer exists on the client record', v_suggestion.field_name
        using errcode = '55000';
    end if;

    execute format(
      'update public.organisations set %I = $1::%s where id = $2',
      v_suggestion.field_name, v_type
    ) using v_suggestion.proposed_value, v_suggestion.organisation_id;

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
  '#80/#81 (F078/F079), rewritten by F020 (#23), 20260923114000 added FIELD_SOURCES '
  'provenance, 20261004210000 casts the applied value to the column''s declared '
  'type so an approved organisation_type suggestion no longer fails with 42804. '
  'Guards, errcodes, audit and notification unchanged.';
