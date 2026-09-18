-- Rollback: import_filter_presets_upsert_key
--
-- Restores the expression index the table shipped with. Saving a filter set
-- fails again once this runs — that is the state being returned to, not a
-- regression introduced here.

drop index if exists public.import_filter_presets_source_name_key;

alter table public.import_filter_presets
  drop column if exists name_key;

create unique index if not exists import_filter_presets_name_key
  on public.import_filter_presets (source, lower(btrim(name)));
