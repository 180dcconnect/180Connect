-- Reverses 20260817100100_add_url_import_provenance.sql.
--
-- Destructive: the provenance of every imported draft is dropped with the columns.
-- The RAW_SOURCE_RECORDS rows the drafts pointed at are left in place — they are
-- evidence, and the separate rollback for 20260817100000 is what removes those.
drop function if exists public.get_organisation_import_origin(uuid);
drop function if exists public.discard_manual_entry_draft(uuid);
drop function if exists public.set_url_import_provenance(uuid, jsonb);
drop function if exists public.create_url_import_draft(
  text, uuid, jsonb, jsonb, text, text, public.organisation_type,
  text, text, text, text, text, text, text, text
);

alter table public.manual_entry_records
  drop constraint if exists manual_entry_import_provenance_consistent,
  drop constraint if exists manual_entry_imported_paths_shape,
  drop constraint if exists manual_entry_import_notes_shape,
  drop column if exists import_notes,
  drop column if exists import_raw_record_id,
  drop column if exists imported_field_paths,
  drop column if exists source_url;

drop function if exists public.jsonb_is_string_array(jsonb);
