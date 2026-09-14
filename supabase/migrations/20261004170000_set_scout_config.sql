-- set_scout_config — the whole scoring setup, not just the weights.
-- Story: F096 Admin Score Settings (#95), follow-up: sector ranking, priority
--   towns and band scores become admin settings instead of code constants.
--
-- WHAT THIS IS: until now an admin could change how much each of the five
--   checks counts, but not what each check rewards. The sector ranking (Health &
--   Wellbeing highest), the branch's priority towns (Sheffield, Rotherham,
--   Barnsley, Doncaster), the score for being in or out of one, and the score per
--   income band were constants in src/lib/scoring/. Changing any of them next
--   year meant a developer, a deploy and a manual backfill. The settings screen is
--   meant to be maintained by non-technical admins (AGENTS.md, "Who will maintain
--   this app"), so these move into the same versioned record the weights already
--   live in.
--
-- WHERE IT LIVES: MODEL_VERSIONS.config, alongside `weights` — the table's
--   existing contract ("history, not an edit": a change retires the active SCOUT
--   row and inserts the next one). Four sections, all required:
--     weights       the five check weights, 0-1 (unchanged shape)
--     sectorScores  one 0-1 score per sector category in score-by-sector.ts
--     geography     { priorityTowns: text[], insideScore, outsideScore }
--     sizeScores    one 0-1 score per public.income_band value
--   Band BOUNDARIES are not here: they are the public.income_band enum.
--
-- ONE TOWN LIST: geography.priorityTowns is also what the client criteria check
--   reads for "is this client local" on import, so scoring and importing cannot
--   disagree about which places matter.
--
-- set_scout_weights IS KEPT, AND FIXED: it used to write config = { weights }
--   only. Called after this migration, that would silently reset every other
--   section to the code defaults. It now carries the rest of the active config
--   forward. (The settings screen switches to set_scout_config.)
--
-- Schema change approval record (SOP §7):
--   Change        | New app.is_unit_number(jsonb) and public.set_scout_config(jsonb);
--                 | public.set_scout_weights(jsonb) redefined to preserve the rest of
--                 | the active config.
--   Reason        | Score settings editable by non-technical admins.
--   Compatibility | Existing config rows (weights only) keep working: the engine
--                 | falls back to the code defaults per missing section. Nothing
--                 | reads the new sections until the app code in the same PR.
--   Data migration| None.
--   Security      | set_scout_config: SECURITY DEFINER, self-checks app.is_admin(),
--                 | validates every section, audits scout_config_changed in the
--                 | same transaction. EXECUTE revoked from public/anon.
--   Documentation | MODEL_VERSIONS.config semantics extended (Data Model tab 06).
--
-- Timestamp: dated after 20261004160000, the latest migration in the tree.
--
-- Reversibility: paired rollback in
-- ../rollback/20261004170000_set_scout_config.down.sql

create or replace function app.is_unit_number(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'number' then false
    else (p_value #>> '{}')::double precision between 0 and 1
  end;
$$;

comment on function app.is_unit_number(jsonb) is
  'True when a jsonb value is a number between 0 and 1. Used by set_scout_config.';

revoke execute on function app.is_unit_number(jsonb) from public;
revoke execute on function app.is_unit_number(jsonb) from anon;

-- ---------------------------------------------------------------------------
-- set_scout_config
-- ---------------------------------------------------------------------------

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

  -- No-op submissions are not audited. `bands` is dropped from the comparison:
  -- only the v1 seed row carries it, and it is not something this function sets.
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

comment on function public.set_scout_config(jsonb) is
  'F096: admin-only change to the whole SCOUT scoring setup — weights, sector scores, '
  'priority towns with in/out scores, and per-income-band scores. Validates every '
  'section, retires the active SCOUT version, inserts the next one and audits '
  'scout_config_changed in one transaction. Same-config submissions are no-ops.';

revoke execute on function public.set_scout_config(jsonb) from public;
revoke execute on function public.set_scout_config(jsonb) from anon;
grant execute on function public.set_scout_config(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- set_scout_weights — unchanged contract, but keeps the rest of the config
-- ---------------------------------------------------------------------------

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

  -- The one change from 20260903120000: carry every other section of the active
  -- config forward (sector scores, towns, size scores), replacing only weights.
  -- `bands` is still dropped, as before — the engine reads thresholds from code.
  insert into public.model_versions
    (model_name, version, implementation_type, config, is_active, notes, created_by_user_id)
  values
    ('SCOUT',
     v_new_version,
     'rules',
     (coalesce(v_active.config, '{}'::jsonb) - 'bands') || jsonb_build_object('weights', p_weights),
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
