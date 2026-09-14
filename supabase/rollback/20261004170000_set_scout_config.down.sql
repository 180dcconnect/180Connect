-- Reverses 20261004170000_set_scout_config.sql: drops set_scout_config and
-- app.is_unit_number, and restores set_scout_weights exactly as shipped in
-- 20260903120000_create_set_scout_weights_rpc.sql (config = { weights } only).

drop function if exists public.set_scout_config(jsonb);
drop function if exists app.is_unit_number(jsonb);

create or replace function public.set_scout_weights(p_weights jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select auth.uid());
  v_active       record;
  v_next_number  int;
  v_new_version  text;
  v_new_id       public.model_versions.id%type;
  v_key          text;
  v_value        jsonb;
begin
  if not app.is_admin() then
    raise exception 'only an admin may change scoring weights'
      using errcode = '42501';
  end if;

  if p_weights is null or jsonb_typeof(p_weights) <> 'object' then
    raise exception 'weights must be a JSON object'
      using errcode = '22023';
  end if;

  foreach v_key in array array['sector', 'geography', 'size', 'partnershipHistory', 'previousContact'] loop
    v_value := p_weights -> v_key;
    if v_value is null or jsonb_typeof(v_value) <> 'number'
       or (v_value #>> '{}')::double precision < 0
       or (v_value #>> '{}')::double precision > 1 then
      raise exception 'weight "%" must be a number between 0 and 1', v_key
        using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
      from jsonb_object_keys(p_weights) as k(key)
     where k.key not in ('sector', 'geography', 'size', 'partnershipHistory', 'previousContact')
  ) then
    raise exception 'weights must contain only sector, geography, size, partnershipHistory and previousContact'
      using errcode = '22023';
  end if;

  if ((p_weights ->> 'sector')::double precision
    + (p_weights ->> 'geography')::double precision
    + (p_weights ->> 'size')::double precision
    + (p_weights ->> 'partnershipHistory')::double precision
    + (p_weights ->> 'previousContact')::double precision) <= 0 then
    raise exception 'at least one weight must be greater than 0'
      using errcode = '22023';
  end if;

  select * into v_active
    from public.model_versions
   where model_name = 'SCOUT' and is_active
   limit 1;

  if v_active.id is null then
    raise exception 'no active SCOUT model version found'
      using errcode = 'P0002';
  end if;

  if v_active.config -> 'weights' = p_weights then
    return v_active.id;
  end if;

  select coalesce(max(nullif(regexp_replace(version, '\D', '', 'g'), '')::int), 0) + 1
    into v_next_number
    from public.model_versions
   where model_name = 'SCOUT';

  v_new_version := 'v' || v_next_number;

  update public.model_versions
     set is_active = false,
         deprecated_at = now()
   where id = v_active.id;

  insert into public.model_versions
    (model_name, version, implementation_type, config, is_active, notes, created_by_user_id)
  values
    ('SCOUT',
     v_new_version,
     'rules',
     jsonb_build_object('weights', p_weights),
     true,
     'F096: weights adjusted from the admin score settings screen',
     v_actor)
  returning id into v_new_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    'scout_weights_changed',
    'model_versions',
    v_new_id,
    jsonb_build_object(
      'from_version', v_active.version,
      'to_version', v_new_version,
      'from', v_active.config -> 'weights',
      'to', p_weights
    )
  );

  return v_new_id;
end;
$$;

revoke execute on function public.set_scout_weights(jsonb) from public;
revoke execute on function public.set_scout_weights(jsonb) from anon;
grant execute on function public.set_scout_weights(jsonb) to authenticated;
