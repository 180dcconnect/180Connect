-- Rollback: add_sector_to_organisations

alter table public.organisations
  drop column if exists sub_sector,
  drop column if exists sector;
