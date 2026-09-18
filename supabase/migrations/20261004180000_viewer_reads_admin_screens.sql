-- viewer_reads_admin_screens — leadership sees what an admin sees, and changes nothing.
-- Story: viewer role scope, decision of the Project Leader, 15 Sep 2026
--   (docs/open-questions.md Q-06, revised).
--
-- WHAT THIS IS: a viewer is 180DC leadership — the branch president and vice
--   president, and the Global Leadership Team. Q-06 (24 Jul 2026) gave them the
--   client record, the communication timeline and per-CAM activity. The revised
--   decision gives them every screen an admin has: approvals, the review queue,
--   the audit log, import runs, data handling rules, restricted fields and score
--   settings. They still write nothing.
--
-- HOW: reads only, and additive only.
--   * One new SELECT policy per admin-read table, `<table>_select_viewer`, for an
--     active viewer. Postgres ORs permissive policies, so every existing policy —
--     admin, own-row, CAM — is untouched, and dropping these policies restores
--     the old behaviour exactly.
--   * The five read-only SECURITY DEFINER functions that self-check app.is_admin()
--     now also accept app.is_viewer(). Bodies are otherwise copied verbatim.
--
-- WHAT IS NOT TOUCHED: every INSERT, UPDATE and DELETE policy, every write RPC,
--   app.can_write() (which excludes viewers, F258) and every grant. A viewer who
--   presses a write control is refused by the application (getCurrentActor) and,
--   underneath it, by the same policies as before.
--
-- NOT WIDENED, deliberately: login_attempt, ai_generation_rate_limit,
--   personal_email_role_parts and score_snapshots. No screen reads them through a
--   signed-in session, so opening them would widen access with nothing to show.
--
-- Schema change approval record (SOP §7):
--   Change        | 17 additive SELECT policies for app.is_viewer(); 5 read-only
--                 | RPCs accept viewers.
--   Reason        | Leadership (GLT, president, VP) oversees the branch from the
--                 | admin screens without being able to change anything.
--   Compatibility | Additive. No existing policy, grant, column or write path changes.
--   Data migration| None.
--   Security      | Read-only widening to active viewers. Viewers now read personal
--                 | data admins already read (raw_source_records payloads,
--                 | feedback, audit_log detail). Write denial unchanged and
--                 | re-asserted by tests.suite_viewer.
--   Documentation | docs/rls-permission-matrix.md, docs/open-questions.md Q-06.
--   Approved by   | Bashir (Project Leader), 15 Sep 2026.
--
-- Timestamp: dated after 20261004170000_set_scout_config, the latest migration on dev.
--
-- Reversibility: paired rollback in
-- ../rollback/20261004180000_viewer_reads_admin_screens.down.sql

-- ---------------------------------------------------------------------------
-- 1. Admin-read tables: an active viewer reads every row an admin reads.
-- ---------------------------------------------------------------------------

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
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using ((select app.is_active_user()) and (select app.is_viewer()))',
      v_table || '_select_viewer', v_table
    );
    execute format(
      'comment on policy %I on public.%I is %L',
      v_table || '_select_viewer', v_table,
      'Leadership (viewer) reads every row an admin reads. Read-only: viewers hold no '
      'write policy. Decision 15 Sep 2026, docs/open-questions.md Q-06.'
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Read-only RPCs that self-check for an admin: accept a viewer too.
-- ---------------------------------------------------------------------------

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
  if not ((app.is_admin() or app.is_viewer()) and app.is_active_user()) then
    raise exception 'Only admins and leadership can read the data handling filter summary';
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
  if not ((app.is_admin() or app.is_viewer()) and app.is_active_user()) then
    raise exception 'Only admins and leadership can read data handling coverage';
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
  if not ((app.is_admin() or app.is_viewer()) and app.is_active_user()) then
    raise exception 'Only admins and leadership can read the fields a source has sent'
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
          -- An object's own keys, or the keys of every object in an array.
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
     -- Leaves only: a nested object is described by its children, and an array of
     -- objects by its `[*]` paths. An array of plain values is a leaf.
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
  'values. Admins and leadership (viewer). Feeds the data handling rules picker so a '
  'rule can only name a field the source really sends.';

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

  -- Reading the list changes nothing, so leadership may see it. Adding or
  -- retiring a field stays admin-only in add_restricted_edit_field.
  if not (app.is_admin() or app.is_viewer()) then
    raise exception 'only an admin may change restricted editing'
      using errcode = '42501';
  end if;

  return query select f from app.restrictable_organisation_fields() as f;
end;
$$;

comment on function public.list_restrictable_edit_fields() is
  'F020: admins and leadership (viewer). The organisations columns '
  'add_restricted_edit_field will accept, so the settings screen can offer a list '
  'instead of asking for a column name. Returns names only. SECURITY DEFINER; '
  'self-checks app.is_admin() or app.is_viewer().';

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
     and (app.is_admin() or app.is_viewer() or o.owner_id = (select auth.uid()));
end;
$$;

comment on function public.get_clients_last_activity(uuid[]) is
  'F160: per-client last-activity timestamps — the newest sent email, received '
  'reply, and audited pipeline status change. Read-only; owner-scoped unless '
  'admin or leadership (viewer) (inaccessible ids are dropped, not errored). Feeds '
  'the Needs Attention panel''s follow-up recommendations and reminder notifications.';
