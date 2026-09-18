-- Rollback for 20261005090000_expand_income_bands.sql

-- 1. Restore 4-band sizeScores in active model_versions
update public.model_versions
   set config = jsonb_set(
     config,
     '{sizeScores}',
     '{"under_10k": 0.2, "10k_100k": 0.4, "100k_1m": 0.6, "over_1m": 0.9}'::jsonb
   )
 where model_name = 'SCOUT'
   and is_active
   and config ? 'sizeScores';

-- 2. Restore 4-key set_scout_config function
create or replace function public.set_scout_config(p_config jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_active      record;
  v_next_number int;
  v_new_version text;
  v_new_id      public.model_versions.id%type;
  v_key         text;
  v_section     jsonb;
  v_towns       jsonb;
  c_weight_keys constant text[] := array['sector', 'geography', 'size', 'partnershipHistory', 'previousContact'];
  c_sector_keys constant text[] := array[
    'Health & Wellbeing', 'Education & Youth', 'Poverty & Community',
    'Social Justice & Enterprise', 'Environment & Sustainability', 'Arts, Culture & Heritage'
  ];
  c_size_keys   constant text[] := array['under_10k', '10k_100k', '100k_1m', 'over_1m'];
begin
  if not app.is_admin() then
    raise exception 'only an admin may change score settings'
      using errcode = '42501';
  end if;

  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'score settings must be a JSON object'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_config) k(key)
     where k.key not in ('weights', 'sectorScores', 'geography', 'sizeScores')
  ) then
    raise exception 'score settings contain an unknown section'
      using errcode = '22023';
  end if;

  -- weights --------------------------------------------------------------
  v_section := p_config -> 'weights';
  if v_section is null or jsonb_typeof(v_section) <> 'object' then
    raise exception 'weights are required'
      using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(v_section) k(key) where k.key <> all (c_weight_keys)) then
    raise exception 'weights must contain only the five checks'
      using errcode = '22023';
  end if;
  foreach v_key in array c_weight_keys loop
    if not app.is_unit_number(v_section -> v_key) then
      raise exception 'weight "%" must be a number between 0 and 1', v_key
        using errcode = '22023';
    end if;
  end loop;
  if (select sum((v_section ->> k)::double precision) from unnest(c_weight_keys) k) <= 0 then
    raise exception 'at least one weight must be greater than 0'
      using errcode = '22023';
  end if;

  -- sectorScores ---------------------------------------------------------
  v_section := p_config -> 'sectorScores';
  if v_section is null or jsonb_typeof(v_section) <> 'object' then
    raise exception 'sector scores are required'
      using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(v_section) k(key) where k.key <> all (c_sector_keys)) then
    raise exception 'sector scores contain an unknown sector'
      using errcode = '22023';
  end if;
  foreach v_key in array c_sector_keys loop
    if not app.is_unit_number(v_section -> v_key) then
      raise exception 'sector score "%" must be a number between 0 and 1', v_key
        using errcode = '22023';
    end if;
  end loop;

  -- sizeScores -----------------------------------------------------------
  v_section := p_config -> 'sizeScores';
  if v_section is null or jsonb_typeof(v_section) <> 'object' then
    raise exception 'size scores are required'
      using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(v_section) k(key) where k.key <> all (c_size_keys)) then
    raise exception 'size scores contain an unknown income band'
      using errcode = '22023';
  end if;
  foreach v_key in array c_size_keys loop
    if not app.is_unit_number(v_section -> v_key) then
      raise exception 'size score "%" must be a number between 0 and 1', v_key
        using errcode = '22023';
    end if;
  end loop;

  -- geography ------------------------------------------------------------
  v_section := p_config -> 'geography';
  if v_section is null or jsonb_typeof(v_section) <> 'object' then
    raise exception 'geography settings are required'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_section) k(key)
     where k.key not in ('priorityTowns', 'insideScore', 'outsideScore')
  ) then
    raise exception 'geography settings contain an unknown field'
      using errcode = '22023';
  end if;
  if not app.is_unit_number(v_section -> 'insideScore')
     or not app.is_unit_number(v_section -> 'outsideScore') then
    raise exception 'geography scores must be numbers between 0 and 1'
      using errcode = '22023';
  end if;
  v_towns := v_section -> 'priorityTowns';
  if v_towns is null or jsonb_typeof(v_towns) <> 'array' then
    raise exception 'priority towns must be a list'
      using errcode = '22023';
  end if;
  if jsonb_array_length(v_towns) > 30 then
    raise exception 'at most 30 priority towns can be set'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_towns) t(town)
     where case
             when jsonb_typeof(t.town) <> 'string' then true
             else btrim(t.town #>> '{}') = '' or length(t.town #>> '{}') > 60
           end
  ) then
    raise exception 'each priority town must be a name of up to 60 characters'
      using errcode = '22023';
  end if;

  -- write ----------------------------------------------------------------
  select * into v_active
    from public.model_versions
   where model_name = 'SCOUT' and is_active
   limit 1;

  if v_active.id is null then
    raise exception 'no active SCOUT model version found'
      using errcode = 'P0002';
  end if;

  if (coalesce(v_active.config, '{}'::jsonb) - 'bands') = p_config then
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
    ('SCOUT', v_new_version, 'rules', p_config, true,
     'Score settings changed from the admin score settings screen', v_actor)
  returning id into v_new_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    'scout_config_changed',
    'model_versions',
    v_new_id,
    jsonb_build_object(
      'from_version', v_active.version,
      'to_version', v_new_version,
      'from', v_active.config,
      'to', p_config
    )
  );

  return v_new_id;
end;
$$;

revoke execute on function public.set_scout_config(jsonb) from public;
revoke execute on function public.set_scout_config(jsonb) from anon;
grant execute on function public.set_scout_config(jsonb) to authenticated;

-- 3. Remap 8-tier financial periods back to 4-tier
update public.financial_periods
   set income_band = case
     when total_income < 10000 then 'under_10k'::public.income_band
     when total_income <= 100000 then '10k_100k'::public.income_band
     when total_income <= 1000000 then '100k_1m'::public.income_band
     else 'over_1m'::public.income_band
   end
 where total_income is not null;
