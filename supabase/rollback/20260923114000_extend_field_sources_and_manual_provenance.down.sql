-- Rollback: extend_field_sources_and_manual_provenance
--
-- Order mirrors the migration's, reversed. The two fix-forward rewrites are
-- restored to their pre-this-migration bodies verbatim (decide_edit_suggestion
-- as 20260822160200 left it; approve_manual_entry as 20260817130000 left it)
-- before anything they call is narrowed — same restore-then-drop discipline as
-- 20260820100000_create_field_sources.down.sql, so no function is left calling
-- something that no longer exists.

-- 1. Restore decide_edit_suggestion (F020 body — no provenance call).
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
    select to_jsonb(o) ->> v_suggestion.field_name
      into v_live_value
      from public.organisations o
     where o.id = v_suggestion.organisation_id;

    if v_live_value is distinct from v_suggestion.current_value then
      raise exception 'the live value changed since this was suggested — review the client and decide again'
        using errcode = '55000';
    end if;

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

-- 2. Restore approve_manual_entry (20260817130000 body — no provenance calls).
create or replace function public.approve_manual_entry(
  p_entry_id                 uuid,
  p_duplicate_decision       text,
  p_admin_confirmed_eligible boolean default null,
  p_candidate_organisation_id uuid default null,
  p_notes                    text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_entry public.manual_entry_records%rowtype;
  v_match_organisation_id uuid;
  v_organisation_id uuid;
  v_normalised_name text;
  v_score numeric;
begin
  if not app.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  select * into v_entry
    from public.manual_entry_records
   where id = p_entry_id
   for update;
  if v_entry.id is null then
    raise exception 'manual entry not found' using errcode = 'P0002';
  end if;
  if v_entry.review_status <> 'pending' then
    raise exception 'manual entry has already been reviewed' using errcode = '55000';
  end if;
  if p_duplicate_decision is null
     or p_duplicate_decision not in ('create_new', 'link_existing') then
    raise exception 'choose whether this is a new or existing organisation' using errcode = '22023';
  end if;

  if v_entry.organisation_type in ('company', 'other')
     and p_admin_confirmed_eligible is not true then
    raise exception 'confirm the organisation is eligible before approval' using errcode = '22023';
  end if;

  if nullif(trim(v_entry.registry_number), '') is not null then
    select identifier.organisation_id into v_match_organisation_id
      from public.organisation_identifiers identifier
     where trim(identifier.identifier_value) = trim(v_entry.registry_number)
     order by identifier.verified desc, identifier.created_at
     limit 1;
  end if;

  if v_match_organisation_id is null then
    v_normalised_name := trim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(trim(v_entry.legal_name)), '[.,()]', '', 'g'),
        '(^|[[:space:]])(ltd|limited)([[:space:]]|$)', ' ', 'g'
      ),
      '[[:space:]]+', ' ', 'g'
    ));

    select organisation.id into v_match_organisation_id
      from public.organisations organisation
     where trim(regexp_replace(
       regexp_replace(
         regexp_replace(lower(trim(organisation.legal_name)), '[.,()]', '', 'g'),
         '(^|[[:space:]])(ltd|limited)([[:space:]]|$)', ' ', 'g'
       ),
       '[[:space:]]+', ' ', 'g'
     )) = v_normalised_name
     order by organisation.created_at, organisation.id
     limit 1;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(nullif(trim(v_entry.registry_number), ''), v_normalised_name),
    0
  ));

  v_match_organisation_id := null;
  if nullif(trim(v_entry.registry_number), '') is not null then
    select identifier.organisation_id into v_match_organisation_id
      from public.organisation_identifiers identifier
     where trim(identifier.identifier_value) = trim(v_entry.registry_number)
     order by identifier.verified desc, identifier.created_at
     limit 1;
  end if;
  if v_match_organisation_id is null then
    select organisation.id into v_match_organisation_id
      from public.organisations organisation
     where trim(regexp_replace(
       regexp_replace(
         regexp_replace(lower(trim(organisation.legal_name)), '[.,()]', '', 'g'),
         '(^|[[:space:]])(ltd|limited)([[:space:]]|$)', ' ', 'g'
       ),
       '[[:space:]]+', ' ', 'g'
     )) = v_normalised_name
     order by organisation.created_at, organisation.id
     limit 1;
  end if;

  if p_candidate_organisation_id is distinct from v_match_organisation_id then
    raise exception 'the duplicate result changed; run the checks again' using errcode = '55000';
  end if;

  if v_match_organisation_id is not null and p_duplicate_decision = 'create_new'
     and length(trim(coalesce(p_notes, ''))) < 3 then
    raise exception 'explain why this matching organisation is genuinely separate' using errcode = '22023';
  end if;
  if v_match_organisation_id is null and p_duplicate_decision = 'link_existing' then
    raise exception 'no existing organisation matches this submission' using errcode = '55000';
  end if;

  if p_duplicate_decision = 'link_existing' then
    v_organisation_id := v_match_organisation_id;
  else
    v_score := round((
      1
      + case when nullif(trim(v_entry.website), '') is not null then 1 else 0 end
      + case when nullif(trim(v_entry.contact_email), '') is not null then 1 else 0 end
      + case when nullif(trim(v_entry.address_line_1), '') is not null then 1 else 0 end
      + case when nullif(trim(v_entry.city), '') is not null then 1 else 0 end
      + case when nullif(trim(v_entry.postcode), '') is not null then 1 else 0 end
    )::numeric / 8, 2);

    insert into public.organisations (
      legal_name, trading_name, country_code, is_international, entry_method,
      is_verified, organisation_type, website, contact_email, address_line_1,
      city, postcode, geographic_reach, data_completeness_score, owner_id, is_seed
    ) values (
      trim(v_entry.legal_name), '', v_entry.country_code, v_entry.country_code <> 'GB',
      'manual', false, v_entry.organisation_type, v_entry.website, v_entry.contact_email,
      v_entry.address_line_1, v_entry.city, v_entry.postcode, null, v_score, null, false
    ) returning id into v_organisation_id;

    insert into public.enrichment_results (
      organisation_id, mission_statement, website_url, confidence_score, needs_review
    ) values (
      v_organisation_id, v_entry.mission_statement, v_entry.website, 1, false
    );

    if nullif(trim(v_entry.registry_number), '') is not null then
      insert into public.organisation_identifiers (
        organisation_id, identifier_type, identifier_value, registry_name,
        registry_country, is_primary, verified
      ) values (
        v_organisation_id, 'manual', trim(v_entry.registry_number),
        nullif(trim(v_entry.registry_name), ''), v_entry.country_code, true, false
      );
    end if;
  end if;

  update public.manual_entry_records set
    converted_to_organisation_id = v_organisation_id,
    review_status = 'approved',
    reviewed_by_user_id = v_actor,
    reviewed_at = now(),
    review_notes = nullif(trim(p_notes), '')
  where id = p_entry_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_duplicate_decision = 'link_existing'
      then 'manual_entry_linked_existing' else 'manual_entry_approved' end,
    'organisations', v_organisation_id,
    jsonb_build_object(
      'manual_entry_id', p_entry_id,
      'submitted_by_user_id', v_entry.submitted_by_user_id,
      'organisation_type', v_entry.organisation_type,
      'duplicate_decision', p_duplicate_decision,
      'matched_organisation_id', v_match_organisation_id,
      'admin_confirmed_eligible', p_admin_confirmed_eligible,
      'notes', nullif(trim(p_notes), '')
    )
  );

  return v_organisation_id;
end;
$$;

-- 3. Drop apply_admin_field_edits entirely (the action reverts to its direct
--    UPDATE, which lives in git, not in the database).
drop function if exists public.apply_admin_field_edits(uuid, jsonb, text);

-- 4. Narrow record_field_source back to the pre-widening body: original
--    signature, six-field validation, no recorded_by. The two-fix-forward
--    functions have already been restored above, so nothing calls the
--    six-arg form any more.
create or replace function public.record_field_source(
  p_organisation_id       uuid,
  p_field_name            text,
  p_value                 text,
  p_source                text,
  p_raw_source_record_id  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_field_name not in
    ('legal_name', 'website', 'contact_email', 'address_line_1', 'city', 'postcode')
  then
    raise exception 'field_name % is not tracked for per-field provenance', p_field_name
      using errcode = '22023';
  end if;

  if p_source not in
    ('charitybase', 'companies_house', '360giving', 'find_that_charity',
     'globalgiving', 'candid', 'charity_commission', 'manual')
  then
    raise exception 'unknown field source: %', p_source using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_organisation_id::text || ':' || p_field_name)
  );

  update public.field_sources
     set is_current = false
   where organisation_id = p_organisation_id
     and field_name = p_field_name
     and is_current = true;

  insert into public.field_sources (
    organisation_id, field_name, value, source, raw_source_record_id, is_current
  )
  values (
    p_organisation_id, p_field_name, p_value, p_source, p_raw_source_record_id, true
  );
end;
$$;

revoke execute on function public.record_field_source(uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_field_source(uuid, text, text, text, uuid)
  to service_role;

drop function if exists public.record_field_source(uuid, text, text, text, uuid, uuid);

-- 5. Narrow get_field_sources back to the admin-only F044 body and policy.
-- Narrowing the OUT columns is a return-type change, which `create or replace`
-- refuses; drop the widened signature first (mirrors the up migration).
drop function if exists public.get_field_sources(uuid);

create or replace function public.get_field_sources(p_organisation_id uuid)
returns table (
  field_name            text,
  value                 text,
  source                text,
  raw_source_record_id  uuid,
  is_current            boolean,
  recorded_at           timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() then
    raise exception 'active account required' using errcode = '42501';
  end if;

  if not app.is_admin() then
    raise exception 'admin account required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organisations where id = p_organisation_id
  ) then
    raise exception 'organisation not found' using errcode = 'P0002';
  end if;

  return query
  select
    fs.field_name,
    fs.value,
    fs.source,
    fs.raw_source_record_id,
    fs.is_current,
    fs.recorded_at
  from public.field_sources fs
  where fs.organisation_id = p_organisation_id
  order by fs.field_name, fs.recorded_at desc;
end;
$$;

revoke execute on function public.get_field_sources(uuid) from public, anon;
grant execute on function public.get_field_sources(uuid) to authenticated;

drop policy if exists field_sources_select on public.field_sources;

create policy field_sources_select_admin on public.field_sources
  for select to authenticated
  using (app.is_admin() and app.is_active_user());

-- 6. Narrow the table: back to the six-field CHECK, drop recorded_by.
--
-- NOTE: unlike the rest of this file this step is not guaranteed to succeed
-- on a database that has been running the widened schema: any organisation_type
-- provenance row written since the migration violates the restored CHECK and
-- Postgres validates it against existing rows. Delete those rows first (they
-- are the rows this migration introduced) — this rollback preserves the
-- schema, not data that only the widened schema could hold.
alter table public.field_sources
  drop constraint field_sources_field_name_check;

alter table public.field_sources
  add constraint field_sources_field_name_check
  check (field_name in
    ('legal_name', 'website', 'contact_email',
     'address_line_1', 'city', 'postcode'));

alter table public.field_sources
  drop column if exists recorded_by;
