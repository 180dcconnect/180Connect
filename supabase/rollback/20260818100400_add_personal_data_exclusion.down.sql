-- Rollback for 20260818100400_add_personal_data_exclusion (F247 #242).
--
-- Reverses the schema and returns DATA_HANDLING_RULES to the state F246 left it
-- in: 16 field_path rules, the F246 four-argument RPC, and the original unique
-- index.
--
-- Two things this deliberately does NOT undo:
--
--   * The rule version is bumped again rather than decremented. Version numbers
--     are stamped onto RAW_SOURCE_RECORDS rows as they are written, and reusing a
--     number would make two different rule sets indistinguishable in that column
--     — an audit reading `rule_version_applied = 17` could not tell which 17.
--     Monotonic in both directions is the only version that stays honest.
--
--   * Payloads already redacted stay redacted. The removed characters are not
--     recoverable from the platform (that is the point), so a rollback restores
--     the control, not the data. Re-fetching from the source is the only route
--     back, and is the correct one.

------------------------------------------------------------------------
-- 1. Seeded rules
------------------------------------------------------------------------

delete from public.data_handling_rules
  where rule_kind <> 'field_path';

delete from public.data_handling_rules
  where rule_kind = 'field_path'
    and created_by is null
    and (source, field_path) in (
      ('companies_house',    'officers[*].name'),
      ('companies_house',    'officers[*].occupation'),
      ('companies_house',    'officers[*].address'),
      ('charity_commission', 'trustees[*].trustee_name'),
      ('charity_commission', 'trustees[*].name'),
      ('charitybase',        'trustees[*].name'),
      ('find_that_charity',  'trustees[*].name')
    );

------------------------------------------------------------------------
-- 2. RPCs
------------------------------------------------------------------------

drop function if exists public.set_personal_email_role_part(text, boolean, text);
drop function if exists public.create_data_handling_rule(text, text, text, text, text);

-- Restore the F246 signature verbatim, so a database rolled back to here behaves
-- exactly as one that never applied this migration.
create or replace function public.create_data_handling_rule(
  p_source       text default null,
  p_field_path   text default null,
  p_action       text default 'deny',
  p_reason       text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_new_version integer;
  v_rule_id     uuid;
begin
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  if not app.is_admin() then
    raise exception 'Only admins can create data handling rules';
  end if;
  if not app.is_active_user() then
    raise exception 'Inactive users cannot create data handling rules';
  end if;

  if p_field_path is null or trim(p_field_path) = '' then
    raise exception 'field_path is required';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason is required';
  end if;
  if p_action not in ('allow', 'deny') then
    raise exception 'action must be ''allow'' or ''deny''';
  end if;

  update public.data_handling_rule_versions
    set current_version = current_version + 1,
        updated_at = now()
    where id = true
    returning current_version into v_new_version;

  insert into public.data_handling_rules
    (rule_version, source, field_path, action, reason, created_by)
  values
    (v_new_version,
     case when p_source is not null then p_source::public.data_source_name else null end,
     trim(p_field_path), p_action, trim(p_reason), v_actor)
  returning id into v_rule_id;

  insert into public.audit_log
    (actor_user_id, action, target_table, target_id, detail)
  values
    (v_actor, 'data_handling_rule_created', 'data_handling_rules', v_rule_id,
     jsonb_build_object(
       'source', p_source,
       'field_path', trim(p_field_path),
       'action', p_action,
       'reason', trim(p_reason),
       'rule_version', v_new_version
     ));

  return v_rule_id;
end;
$$;

revoke execute on function public.create_data_handling_rule(text, text, text, text)
  from public, anon;
grant execute on function public.create_data_handling_rule(text, text, text, text)
  to authenticated;

------------------------------------------------------------------------
-- 3. app.is_personal_email and the role list
------------------------------------------------------------------------

drop function if exists app.is_personal_email(text);
drop table if exists public.personal_email_role_parts;

------------------------------------------------------------------------
-- 4. rule_kind and the index
------------------------------------------------------------------------
-- The index goes back to the F246 form, NULLS DISTINCT bug included. A rollback
-- that quietly kept a fix is a rollback that did not restore the prior state, and
-- the fix travels with the migration that made it.

drop index if exists public.data_handling_rules_active_unique;

alter table public.data_handling_rules
  drop constraint if exists data_handling_rules_redaction_denies;

alter table public.data_handling_rules
  drop column if exists rule_kind;

create unique index data_handling_rules_active_unique
  on public.data_handling_rules (source, field_path)
  where (is_active = true);

------------------------------------------------------------------------
-- 5. Version
------------------------------------------------------------------------

update public.data_handling_rule_versions
  set current_version = current_version + 1, updated_at = now()
  where id = true;

insert into public.audit_log
  (actor_user_id, action, target_table, detail)
values
  (null, 'data_handling_rules_rolled_back', 'data_handling_rules',
   jsonb_build_object(
     'rule_version', (select current_version from public.data_handling_rule_versions where id = true),
     'origin', 'migration_rollback',
     'story', 'F247',
     'note', 'F247 rules removed. Payloads already redacted are not restored.'
   ));
