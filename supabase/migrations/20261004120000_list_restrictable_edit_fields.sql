-- list_restrictable_edit_fields — let the Restricted fields screen offer a list.
-- Story: F020 Restricted Editing (#23), usability follow-up.
--
-- WHAT THIS IS: the restricted-fields admin screen asked an admin to type a
--   Postgres column name ("trading_name") into a text box. The people who run this
--   screen are not developers, and nothing on the page told them which names
--   exist. The rule for which columns may be restricted already lived in
--   add_restricted_edit_field; this migration moves it into one helper so the
--   screen can *ask* for the list and show it as a dropdown, and the add RPC keeps
--   enforcing exactly the same rule.
--
-- ONE LIST, TWO READERS:
--   app.restrictable_organisation_fields()  the rule (text columns of
--                                           organisations, minus the protected set)
--   add_restricted_edit_field               validates against it (behaviour unchanged)
--   list_restrictable_edit_fields()         returns it to an admin for the dropdown
--   A text column added to organisations by a later migration appears in the
--   dropdown automatically; the app shows a derived label until someone writes a
--   friendly one in src/lib/edit-suggestions.ts.
--
-- Schema change approval record (SOP §7):
--   Change        | New app.restrictable_organisation_fields() and
--                 | public.list_restrictable_edit_fields(); add_restricted_edit_field
--                 | rewritten to use the helper instead of its inline list.
--   Reason        | Restricted fields screen usable by non-technical admins.
--   Compatibility | add_restricted_edit_field keeps its signature, errcodes, messages,
--                 | reactivate-on-conflict and audit behaviour. Same protected set.
--   Data migration| None.
--   Security      | Both new functions SECURITY DEFINER with search_path ''. The list
--                 | RPC self-checks app.is_active_user() and app.is_admin() — same gate
--                 | as the add RPC — and returns column names only, never data. The
--                 | helper is not executable by client roles.
--   Documentation | Functions only; no Data Model entity or dictionary change.
--
-- Timestamp: dated after 20261004110000_add_users_accessibility_settings, the latest migration in the tree.
--
-- Reversibility: paired rollback in
-- ../rollback/20261004120000_list_restrictable_edit_fields.down.sql

create or replace function app.restrictable_organisation_fields()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  -- information_schema rather than pg_attribute, so a renamed or dropped column
  -- simply stops appearing. SECURITY DEFINER because information_schema only shows
  -- columns the *caller* holds a privilege on, and organisations' column grants
  -- are deliberately narrow.
  select c.column_name::text
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name   = 'organisations'
     and c.data_type    = 'text'
     -- System, provenance, computed and enum-backed columns whose writes already
     -- have their own audited or constrained paths. Unchanged from
     -- 20260822160000_create_restricted_edit_fields.sql.
     and c.column_name not in (
       'id', 'owner_id', 'created_at', 'updated_at',
       'entry_method', 'is_seed', 'is_verified', 'data_completeness_score',
       'outreach_status', 'country_code', 'is_international',
       'organisation_type', 'geographic_reach'
     )
   order by c.ordinal_position;
$$;

comment on function app.restrictable_organisation_fields() is
  'F020: the organisations columns an admin may put under restricted editing — text '
  'columns outside the protected system/provenance/enum set. The single definition '
  'read by add_restricted_edit_field and list_restrictable_edit_fields.';

revoke execute on function app.restrictable_organisation_fields() from public;
revoke execute on function app.restrictable_organisation_fields() from anon;
revoke execute on function app.restrictable_organisation_fields() from authenticated;

-- ---------------------------------------------------------------------------
-- add_restricted_edit_field — same contract, rule read from the helper
-- ---------------------------------------------------------------------------

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

  if v_field not in (select app.restrictable_organisation_fields()) then
    raise exception '% is not a restrictable client field', coalesce(nullif(v_field, ''), '(blank)')
      using errcode = '23514';
  end if;

  -- Re-adding a retired field reactivates it instead of duplicating the row.
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

-- ---------------------------------------------------------------------------
-- list_restrictable_edit_fields — the dropdown's options, admin-only
-- ---------------------------------------------------------------------------

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

revoke execute on function public.list_restrictable_edit_fields() from public;
revoke execute on function public.list_restrictable_edit_fields() from anon;
grant execute on function public.list_restrictable_edit_fields() to authenticated;
