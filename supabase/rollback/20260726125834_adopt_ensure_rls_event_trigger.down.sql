-- Rollback for: 20260726125834_adopt_ensure_rls_event_trigger.sql
-- Story: F224 (#219)
-- Apply manually against the target DB to reverse the paired migration.
--
-- Removes the guard entirely rather than restoring public.rls_auto_enable(): the public
-- copy only ever existed because of the Supabase project-creation option, and putting a
-- SECURITY DEFINER function back into an exposed schema would re-raise advisors
-- 0028/0029. After this, a table created outside the migration path no longer gets RLS
-- turned on automatically — scripts/verify-rls-coverage.sql remains the real gate, and
-- it only sees changes that go through CI.

drop event trigger if exists ensure_rls;

drop function if exists app.rls_auto_enable();
