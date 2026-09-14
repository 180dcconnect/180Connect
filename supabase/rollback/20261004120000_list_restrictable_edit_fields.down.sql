-- Reverses 20261004120000_list_restrictable_edit_fields.sql: restores
-- add_restricted_edit_field's inline column check (as shipped in
-- 20260822160000_create_restricted_edit_fields.sql) and drops the two new functions.

drop function if exists public.list_restrictable_edit_fields();

create or replace function public.add_restricted_edit_field(
  p_field_name text,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_field  text := btrim(coalesce(p_field_name, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id     uuid;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_admin() then
    raise exception 'only an admin may change restricted editing'
      using errcode = '42501';
  end if;

  if v_reason = '' then
    raise exception 'a reason is required — the admin panel shows why a field is locked'
      using errcode = '23514';
  end if;

  if v_field in (
    'id', 'owner_id', 'created_at', 'updated_at',
    'entry_method', 'is_seed', 'is_verified', 'data_completeness_score',
    'outreach_status', 'country_code', 'is_international',
    'organisation_type', 'geographic_reach'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'organisations'
       and column_name  = v_field
       and data_type    = 'text'
  ) then
    raise exception '% is not a restrictable client field', coalesce(nullif(v_field, ''), '(blank)')
      using errcode = '23514';
  end if;

  insert into public.restricted_edit_fields (field_name, reason, added_by)
  values (v_field, v_reason, v_actor)
  on conflict (field_name) do update
    set active   = true,
        reason   = excluded.reason,
        added_by = excluded.added_by
  returning id into v_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'restricted_field_added', 'organisations', null,
    jsonb_build_object('field', v_field, 'reason', v_reason)
  );

  return v_id;
end;
$$;

drop function if exists app.restrictable_organisation_fields();
