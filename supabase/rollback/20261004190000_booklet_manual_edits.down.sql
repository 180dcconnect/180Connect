-- Rollback for 20261004190000_booklet_manual_edits.sql: drops the two manual-edit
-- columns. Rows written as manual edits keep their text and order (generated_at
-- is untouched) but lose their edited-by attribution — only roll back before
-- any edit has been saved, or accept that loss.

alter table public.client_booklets
  drop column if exists edited_from_version_id,
  drop column if exists edited_by_user_id;
