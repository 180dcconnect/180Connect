-- Rollback for 20261004180000_viewer_reads_admin_screens.sql
--
-- Drops the viewer SELECT policies and restores the five read-only RPCs to their
-- admin-only bodies (as defined in 20260818100200, 20261004120000, 20261004130000
-- and 20260910100000). No data is touched.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'audit_log',
    'booklet_generations',
    'data_handling_rule_versions',
    'data_handling_rules',
    'data_quality_events',
    'edit_suggestions',
    'entity_match_candidates',
    'feedback',
    'field_discrepancies',
    'ingestion_runs',
    'manual_entry_records',
    'model_versions',
    'organisation_status_flags',
    'outreach_preferences',
    'ownership_requests',
    'raw_source_records',
    'restricted_edit_fields'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', v_table || '_select_viewer', v_table);
  end loop;
end;
$$;

create or replace function public.data_handling_filter_summary()
returns table (
  field_path       text,
  records_affected bigint,
  last_applied     timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.is_admin() and app.is_active_user()) then
    raise exception 'Only admins can read the data handling filter summary';
  end if;

  return query
    select
      excluded.path,
      count(*),
      max(r.received_at)
    from public.raw_source_records r
      cross join lateral jsonb_array_elements_text(r.excluded_fields) as excluded(path)
    where r.excluded_fields is not null
    group by excluded.path
    order by count(*) desc, excluded.path;
end;
$$;

create or replace function public.data_handling_coverage()
returns table (
  records_total    bigint,
  records_checked  bigint,
  records_stripped bigint,
  rule_version     integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.is_admin() and app.is_active_user()) then
    raise exception 'Only admins can read data handling coverage';
  end if;

  return query
    select
      count(*),
      count(*) filter (where r.excluded_fields is not null),
      count(*) filter (where jsonb_array_length(coalesce(r.excluded_fields, '[]'::jsonb)) > 0),
      (select v.current_version from public.data_handling_rule_versions v where v.id = true)
    from public.raw_source_records r;
end;
$$;

create or replace function public.data_handling_observed_fields(p_source text)
returns table (
  field_path      text,
  records_seen    bigint,
  records_sampled bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sample_size constant integer := 300;
  v_max_depth   constant integer := 4;
begin
  if not (app.is_admin() and app.is_active_user()) then
    raise exception 'Only admins can read the fields a source has sent'
      using errcode = '42501';
  end if;

  if p_source is null or btrim(p_source) = '' then
    raise exception 'Choose a source'
      using errcode = '22023';
  end if;

  return query
    with recursive sample as (
      select r.id, r.raw_payload
        from public.raw_source_records r
       where r.record_source::text = p_source
       order by r.received_at desc
       limit v_sample_size
    ),
    walk (record_id, path, value, depth) as (
      select s.id, e.key, e.value, 1
        from sample s
        cross join lateral jsonb_each(
          case when jsonb_typeof(s.raw_payload) = 'object' then s.raw_payload else '{}'::jsonb end
        ) e
      union all
      select w.record_id,
             case when jsonb_typeof(w.value) = 'array'
                  then w.path || '[*].' || c.key
                  else w.path || '.' || c.key end,
             c.value,
             w.depth + 1
        from walk w
        cross join lateral (
          select el
            from jsonb_array_elements(
                   case when jsonb_typeof(w.value) = 'array' then w.value else '[]'::jsonb end
                 ) el
           where jsonb_typeof(el) = 'object'
          union all
          select w.value where jsonb_typeof(w.value) = 'object'
        ) parent (el)
        cross join lateral jsonb_each(parent.el) c
       where w.depth < v_max_depth
    )
    select w.path,
           count(distinct w.record_id),
           (select count(*) from sample)
      from walk w
     where jsonb_typeof(w.value) <> 'object'
       and not (
         jsonb_typeof(w.value) = 'array'
         and jsonb_path_exists(w.value, '$[*] ? (@.type() == "object")')
       )
     group by w.path
     order by w.path;
end;
$$;

comment on function public.data_handling_observed_fields(text) is
  'F246: the field paths that occur in the most recent 300 stored records from one '
  'source, with how many of those records contain each. Names and counts only, never '
  'values. Admin-only. Feeds the data handling rules picker so a rule can only name a '
  'field the source really sends.';

create or replace function public.list_restrictable_edit_fields()
returns table (field_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_admin() then
    raise exception 'only an admin may change restricted editing'
      using errcode = '42501';
  end if;

  return query select f from app.restrictable_organisation_fields() as f;
end;
$$;

comment on function public.list_restrictable_edit_fields() is
  'F020: admin-only. The organisations columns add_restricted_edit_field will accept, '
  'so the settings screen can offer a list instead of asking for a column name. '
  'Returns names only. SECURITY DEFINER; self-checks app.is_admin().';

create or replace function public.get_clients_last_activity(
  p_organisation_ids uuid[]
)
returns table (
  organisation_id uuid,
  last_email_sent_at timestamptz,
  last_reply_received_at timestamptz,
  last_status_change_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  return query
  select o.id,
         (select max(m.sent_at)
            from public.outreach_messages m
           where m.organisation_id = o.id
             and m.send_status = 'sent'),
         (select max(r.received_at)
            from public.reply_events r
           where r.organisation_id = o.id),
         (select max(a.created_at)
            from public.audit_log a
           where a.target_table = 'organisations'
             and a.action = 'status_changed'
             and a.target_id = o.id)
    from public.organisations o
   where o.id = any(p_organisation_ids)
     and (app.is_admin() or o.owner_id = (select auth.uid()));
end;
$$;

comment on function public.get_clients_last_activity(uuid[]) is
  'F160: per-client last-activity timestamps — the newest sent email, received '
  'reply, and audited pipeline status change. Read-only; owner-scoped unless '
  'admin (inaccessible ids are dropped, not errored). Feeds the Needs Attention '
  'panel''s follow-up recommendations and, later, reminder notifications (F175).';
