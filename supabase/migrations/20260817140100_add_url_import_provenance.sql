-- Migration: add_url_import_provenance
-- Sequence: extends step 7.0 (create_quality) — the MANUAL_ENTRY_RECORDS table
--   created by 20260817130000_create_manual_entry_records.sql (F036). No new table.
-- Story: F037 Manual URL Import. A URL import does not get its own staging table:
--   it produces a MANUAL_ENTRY_RECORDS draft, which the CAM then reviews and
--   submits through the F036 flow. That is what makes F037's acceptance criteria
--   for review-before-save, duplicate handling and admin approval fall out of work
--   that already exists rather than being reimplemented beside it.
--
--   What this migration adds is the part F036 has no reason to know about: where a
--   draft's values came from, and what the import could not confirm.
--
-- Schema change approval record (SOP §7):
--   Change        | Add source_url, imported_field_paths, import_notes and
--                 | import_raw_record_id to public.manual_entry_records. Add
--                 | public.create_url_import_draft, public.set_url_import_provenance,
--                 | public.discard_manual_entry_draft and
--                 | public.get_organisation_import_origin.
--   Reason        | F037 AC8 (the CAM can identify which information was imported
--                 | from the external website) and AC12 (the source URL is retained
--                 | with the imported record so the origin can be identified).
--   Compatibility | Additive. All four columns are nullable or defaulted, so every
--                 | existing draft and every hand-typed F036 entry stays valid — a
--                 | manual entry with no source_url is simply one nobody imported.
--   Data migration| None.
--   Security      | Writes stay RPC-only, matching F036. create_url_import_draft
--                 | requires app.can_write() and always writes the caller as the
--                 | submitter, so a CAM cannot seed a draft under another user.
--                 | set_url_import_provenance is restricted to the draft's own
--                 | submitter while the draft is still a draft.
--                 | get_organisation_import_origin is readable by any active user
--                 | because provenance is not confidential — it is the answer to
--                 | "where did this client come from", which every CAM looking at
--                 | the profile needs. It exposes the URL and the field-name list
--                 | only, never the submission's other contents.
--   Documentation | Data Model tab "03 Raw Data", MANUAL_ENTRY_RECORDS: four new
--                 | field rows, listed in docs/manual-url-import.md.
--   Approved by   | Pending — raised with Bashir (Project Leader) on 2026-08-17.
--
-- Reversibility: paired rollback in
-- ../rollback/20260817140100_add_url_import_provenance.down.sql

alter table public.manual_entry_records
  add column source_url text
    check (source_url is null or length(trim(source_url)) between 1 and 2000),
  add column imported_field_paths jsonb not null default '[]'::jsonb,
  add column import_notes jsonb not null default '[]'::jsonb,
  add column import_raw_record_id uuid references public.raw_source_records (id);

-- Both new jsonb columns are flat arrays of strings. Reject anything else at the
-- boundary: imported_field_paths drives what the review screen labels as imported,
-- and a malformed value would silently mislabel a CAM's own typing as machine-
-- supplied, while import_notes is rendered straight to the CAM.
--
-- A function rather than the constraint expression itself, because a CHECK cannot
-- contain a subquery and unnesting a jsonb array needs one. Marked immutable so the
-- planner will accept it there: it reads nothing but its argument.
create or replace function public.jsonb_is_string_array(p_value jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'array'
     and not exists (
       select 1
         from jsonb_array_elements(p_value) as element
        where jsonb_typeof(element) <> 'string'
     );
$$;

comment on function public.jsonb_is_string_array(jsonb) is
  'True when the value is a jsonb array containing only strings. Exists so a CHECK '
  'constraint can assert that shape, which it cannot do inline (no subqueries in '
  'CHECK).';

alter table public.manual_entry_records
  add constraint manual_entry_imported_paths_shape
    check (public.jsonb_is_string_array(imported_field_paths)),
  add constraint manual_entry_import_notes_shape
    check (public.jsonb_is_string_array(import_notes));

-- Provenance is all-or-nothing: fields cannot be marked as imported by a record
-- that cannot say where they were imported from.
alter table public.manual_entry_records
  add constraint manual_entry_import_provenance_consistent check (
    source_url is not null or imported_field_paths = '[]'::jsonb
  );

comment on column public.manual_entry_records.source_url is
  'The website the values on this draft were imported from, after redirects (F037 '
  'AC12). Null for a manual entry the CAM typed from scratch. Distinct from the '
  'website column: that is the organisation''s website as it will be stored, this is '
  'the page that was actually fetched, which may be a subpage or a pre-redirect URL.';
comment on column public.manual_entry_records.imported_field_paths is
  'Which columns on this row were filled by the import rather than typed by the CAM '
  '(F037 AC8). Maintained as the CAM edits: a field they overwrite stops being '
  'imported. Empty array when nothing was imported.';
comment on column public.manual_entry_records.import_notes is
  'What the import could not confirm, in the words the CAM was shown (F256): a '
  'registration number the register did not recognise, a register 180Connect does '
  'not check, a mission the website never stated. Stored rather than shown once and '
  'lost, because the CAM reviews the draft on a later page load than the one the '
  'import finished on, and an admin reviewing the submission later needs the same '
  'caveats the CAM had.';
comment on column public.manual_entry_records.import_raw_record_id is
  'The RAW_SOURCE_RECORDS row holding the fetched page this draft was built from, so '
  'a disputed value can be traced back to the bytes it came from.';

-- Nothing is saved that the CAM has not confirmed (F037 AC9), so the import writes a
-- draft — never a pending submission, never an organisation. p_submit does not exist
-- on this function on purpose; submission stays with save_manual_entry, which the CAM
-- reaches only by pressing the button on the review form.
create or replace function public.create_url_import_draft(
  p_source_url text,
  p_raw_record_id uuid,
  p_imported_field_paths jsonb,
  p_import_notes jsonb,
  p_legal_name text,
  p_mission_statement text,
  p_organisation_type public.organisation_type,
  p_address_line_1 text,
  p_city text,
  p_postcode text,
  p_country_code text,
  p_website text,
  p_contact_email text,
  p_registry_name text,
  p_registry_number text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if not app.can_write() then
    raise exception 'CAM or admin access required' using errcode = '42501';
  end if;

  if nullif(trim(p_source_url), '') is null then
    raise exception 'an imported draft must record the URL it came from' using errcode = '22023';
  end if;

  insert into public.manual_entry_records (
    submitted_by_user_id, legal_name, mission_statement, organisation_type,
    address_line_1, city, postcode, country_code, website, contact_email,
    registry_name, registry_number, review_status,
    source_url, imported_field_paths, import_notes, import_raw_record_id
  ) values (
    v_actor, nullif(trim(p_legal_name), ''), nullif(trim(p_mission_statement), ''),
    p_organisation_type, nullif(trim(p_address_line_1), ''), nullif(trim(p_city), ''),
    nullif(trim(p_postcode), ''), nullif(upper(trim(p_country_code)), ''),
    nullif(trim(p_website), ''), nullif(trim(p_contact_email), ''),
    nullif(trim(p_registry_name), ''), nullif(trim(p_registry_number), ''), 'draft',
    trim(p_source_url), coalesce(p_imported_field_paths, '[]'::jsonb),
    coalesce(p_import_notes, '[]'::jsonb), p_raw_record_id
  ) returning id into v_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'url_import_drafted', 'manual_entry_records', v_id,
    jsonb_build_object(
      'from', null,
      'to', 'draft',
      'source_url', trim(p_source_url),
      'imported_field_paths', coalesce(p_imported_field_paths, '[]'::jsonb)
    )
  );

  return v_id;
end;
$$;

-- Called alongside save_manual_entry when the CAM saves a draft that came from an
-- import. save_manual_entry deliberately does not touch the provenance columns —
-- extending its signature would mean editing F036's migration — so the narrower
-- question "which of these values are still the imported ones" is answered here.
create or replace function public.set_url_import_provenance(
  p_entry_id uuid,
  p_imported_field_paths jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing public.manual_entry_records%rowtype;
begin
  if not app.can_write() then
    raise exception 'CAM or admin access required' using errcode = '42501';
  end if;

  select * into v_existing
    from public.manual_entry_records
   where id = p_entry_id
   for update;

  if v_existing.id is null
     or v_existing.submitted_by_user_id <> v_actor
     or v_existing.review_status <> 'draft' then
    raise exception 'this draft is not available to edit' using errcode = '42501';
  end if;

  if v_existing.source_url is null then
    raise exception 'this entry was not created from an import' using errcode = '22023';
  end if;

  -- Only ever narrows. A field the CAM has edited stops being imported; a field can
  -- never become imported after the fetch that produced the draft.
  update public.manual_entry_records set
    imported_field_paths = (
      select coalesce(jsonb_agg(retained.path), '[]'::jsonb)
        from jsonb_array_elements_text(v_existing.imported_field_paths) as retained(path)
       where retained.path in (
         select claimed.path
           from jsonb_array_elements_text(coalesce(p_imported_field_paths, '[]'::jsonb))
             as claimed(path)
       )
    )
  where id = p_entry_id;
end;
$$;

-- Rejecting an import is a first-class outcome (F037 testing notes: "CAM reviewing
-- and rejecting imported information"), and without this the only way to decline an
-- import is to abandon a draft that then sits in the CAM's list forever. Restricted
-- to the submitter's own drafts: a submitted or reviewed entry is part of the audit
-- trail and is never deleted from here.
create or replace function public.discard_manual_entry_draft(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing public.manual_entry_records%rowtype;
begin
  if not app.can_write() then
    raise exception 'CAM or admin access required' using errcode = '42501';
  end if;

  select * into v_existing
    from public.manual_entry_records
   where id = p_entry_id
   for update;

  if v_existing.id is null
     or v_existing.submitted_by_user_id <> v_actor
     or v_existing.review_status <> 'draft' then
    raise exception 'this draft is not available to discard' using errcode = '42501';
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'manual_entry_draft_discarded', 'manual_entry_records', p_entry_id,
    jsonb_build_object(
      'from', 'draft',
      'to', null,
      'source_url', v_existing.source_url,
      'legal_name', v_existing.legal_name
    )
  );

  delete from public.manual_entry_records where id = p_entry_id;
end;
$$;

-- F037 AC8/AC12 on the client profile. The manual_entry_records RLS policy is
-- submitter-or-admin, which is right for the submission's contents but wrong for
-- its provenance: any CAM looking at a client needs to know the profile was built
-- from a website and which one. This returns those two facts and nothing else.
create or replace function public.get_organisation_import_origin(p_organisation_id uuid)
returns table (
  source_url text,
  imported_field_paths jsonb,
  imported_at timestamptz
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

  return query
  select entry.source_url, entry.imported_field_paths, entry.created_at
    from public.manual_entry_records entry
   where entry.converted_to_organisation_id = p_organisation_id
     and entry.review_status = 'approved'
     and entry.source_url is not null
   order by entry.created_at
   limit 1;
end;
$$;

revoke execute on function public.create_url_import_draft(
  text,uuid,jsonb,jsonb,text,text,public.organisation_type,text,text,text,text,text,text,text,text
) from public, anon;
grant execute on function public.create_url_import_draft(
  text,uuid,jsonb,jsonb,text,text,public.organisation_type,text,text,text,text,text,text,text,text
) to authenticated;

revoke execute on function public.set_url_import_provenance(uuid,jsonb) from public, anon;
grant execute on function public.set_url_import_provenance(uuid,jsonb) to authenticated;

revoke execute on function public.discard_manual_entry_draft(uuid) from public, anon;
grant execute on function public.discard_manual_entry_draft(uuid) to authenticated;

-- No DELETE grant or policy is added for authenticated. The RPC above is SECURITY
-- DEFINER, so it does the delete as the owner after checking who is asking and
-- writing the audit row; a direct client-side delete stays impossible.

revoke execute on function public.get_organisation_import_origin(uuid) from public, anon;
grant execute on function public.get_organisation_import_origin(uuid) to authenticated;
